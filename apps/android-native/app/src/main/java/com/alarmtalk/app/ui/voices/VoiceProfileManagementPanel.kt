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
import androidx.compose.material.icons.outlined.Lock
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.alarmtalk.app.R
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

// 처음 목소리를 만드는 사용자를 위한 단계 가이드 (handoff 코치마크 카피 참고).
@Composable
private fun rememberVoiceCreateGuideSteps(): List<UsageGuideStep> = listOf(
    UsageGuideStep(
        icon = Icons.Outlined.Mic,
        title = stringResource(R.string.voices2_guide_record_title),
        body = stringResource(R.string.voices2_guide_record_body),
    ),
    UsageGuideStep(
        icon = Icons.Outlined.Badge,
        title = stringResource(R.string.voices2_guide_identity_title),
        body = stringResource(R.string.voices2_guide_identity_body),
    ),
    UsageGuideStep(
        icon = Icons.Outlined.AutoAwesome,
        title = stringResource(R.string.voices2_guide_register_title),
        body = stringResource(R.string.voices2_guide_register_body),
    ),
)

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
            Row(
                // 확장/축소 토글 — 눌림 리플(indication) 없이 조용히 동작.
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                    ) { expanded = !expanded }
                    .padding(horizontal = 16.dp, vertical = 14.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = stringResource(R.string.voices_show_recommended_script),
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
                    contentDescription = if (expanded) {
                        stringResource(R.string.voices_collapse)
                    } else {
                        stringResource(R.string.voices_expand)
                    },
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (expanded) {
                Text(
                    text = stringResource(R.string.voices2_record_script),
                    modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 16.dp),
                    style = MaterialTheme.typography.bodyMedium,
                    lineHeight = MaterialTheme.typography.bodyLarge.lineHeight,
                    color = MaterialTheme.colorScheme.onSurface,
                )
            }
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
    // 기본 제공 목소리는 정보성이라 평소엔 접어두고 헤더만 보여준다.
    var systemVoicesExpanded by remember { mutableStateOf(false) }
    // 지금 인사말 샘플을 재생 중인 기본 목소리 id (재생 아이콘 토글용).
    var playingGreetingVoiceId by remember { mutableStateOf<String?>(null) }
    // 시스템 스톡 보이스는 "내 목소리" 수 제한·관리 액션에서 제외한다.
    // 매 리컴포지션마다 재계산하지 않도록 voiceProfiles 가 바뀔 때만 다시 분류한다.
    val systemVoices = remember(voiceProfiles) { voiceProfiles.filter { it.isSystem == true } }
    val ownVoices = remember(voiceProfiles) { voiceProfiles.filter { it.isSystem != true } }
    val isLimitReached = ownVoices.size >= MAX_VOICE_PROFILES
    val canCreateVoice = hasPaidVoiceAccess(subscriptionResponse)
    val canShareVoice = canShareVoiceWithOthers(subscriptionResponse, familyGroup, authSession)
    val paidVoiceRequiredMessage = stringResource(R.string.voices_paid_required)

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
            localMessage = context.getString(R.string.voices_greeting_preview_preparing)
            return
        }
        scope.launch {
            stopMediaPreview()
            playingGreetingVoiceId = profile.id
            runCatching {
                val response = onDownloadStockAudio(clip.messageId)
                val cached = withContext(Dispatchers.IO) {
                    // base64 디코딩도 메인 스레드가 아닌 IO 디스패처에서 수행한다.
                    val bytes = Base64.decode(response.audioBase64, Base64.DEFAULT)
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
                localMessage = userFacingError(error, context.getString(R.string.voices_preview_play_failed))
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
                activePlayingSpeakerId = null
                localMessage = voiceProfileFileDurationError(context, durationMillis)
            }
                .onFailure { error ->
                    Log.e(TAG, "Failed to cache voice profile audio", error)
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
                val error = voiceProfileDurationError(context, audio.durationMillis)
                if (error == null) {
                    applySelectedAudio(audio)
                } else {
                    selectedAudio = null
                    localMessage = error
                }
            }.onFailure { error ->
                isRecording = false
                Log.e(TAG, "Failed to stop voice profile recording", error)
                localMessage = userFacingError(error, context.getString(R.string.voices_recording_stop_failed))
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
            localMessage = userFacingError(error, context.getString(R.string.voices_recording_start_failed))
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
            val draftName = baseName.ifBlank { voiceProfilePlaceholder(context) }
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
        val uri = selectedFileUri ?: return
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
                localMessage = if (visible.isEmpty()) context.getString(R.string.voices_no_speakers_found) else null
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
            Log.e(TAG, "Failed to preview shared voice", error)
            localMessage = userFacingError(error, context.getString(R.string.voices_preview_play_failed))
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
                localMessage = context.getString(R.string.voices_registered_success)
            }.onFailure { error ->
                Log.e(TAG, "Failed to promote draft voice id=$selectedDraftId", error)
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
                Log.e(TAG, "Failed to play cropped voice preview", error)
                filePreviewPreparing = false
                filePreviewPlaying = false
                localMessage = userFacingError(error, context.getString(R.string.voices_preview_play_failed))
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
        if (fileSpeakerMode == FileSpeakerMode.Multiple) {
            localMessage = context.getString(R.string.voices_select_separated_voice)
            return
        }
        scope.launch {
            createPreparing = true
            localMessage = null
            runCatching {
                croppedFileAudio()
            }.onSuccess { audio ->
                val error = voiceProfileDurationError(context, audio.durationMillis)
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
                Log.e(TAG, "Failed to prepare selected voice file", error)
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
                    Text(stringResource(R.string.voices_add))
                } else {
                    // 무료 플랜: 텍스트 없이 자물쇠 아이콘만 — '유료 잠금'을 간결하게.
                    // 보이는 라벨이 없으므로 contentDescription 으로 스크린리더 라벨('잠금')을 단다.
                    Icon(
                        imageVector = Icons.Outlined.Lock,
                        contentDescription = stringResource(R.string.voices_locked),
                        modifier = Modifier.size(18.dp),
                    )
                }
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
                // 확장/축소 토글 — 눌림 리플(indication) 없이 조용히 동작.
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                    ) { systemVoicesExpanded = !systemVoicesExpanded }
                    .padding(vertical = 4.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                val defaultVoiceName = systemVoices.firstOrNull { it.id == defaultVoiceId }?.name
                Text(
                    // 기본 목소리가 정해져 있으면 그 이름을, 아니면 종 수를 보여준다.
                    text = if (defaultVoiceName != null) {
                        stringResource(R.string.voices_default_voice_header, defaultVoiceName)
                    } else {
                        stringResource(R.string.voices_system_voices_count, systemVoices.size)
                    },
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                )
                Icon(
                    imageVector = if (systemVoicesExpanded) {
                        Icons.Outlined.KeyboardArrowUp
                    } else {
                        Icons.Outlined.KeyboardArrowDown
                    },
                    contentDescription = if (systemVoicesExpanded) {
                        stringResource(R.string.voices_collapse)
                    } else {
                        stringResource(R.string.voices_expand)
                    },
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (systemVoicesExpanded) {
                systemVoices.forEach { profile ->
                    SystemVoiceProfileRow(
                        profile = profile,
                        playing = playingGreetingVoiceId == profile.id,
                        onPlay = { playGreeting(profile) },
                        selected = profile.id == defaultVoiceId,
                        onSelect = { onSetDefaultVoice(profile.id) },
                    )
                }
            }
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
            message = stringResource(R.string.voices_create_paid_notice),
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
                                text = stringResource(R.string.voices_create_dialog_title),
                                style = MaterialTheme.typography.titleLarge,
                                fontWeight = FontWeight.Bold,
                            )
                            val stepIndex = currentStep.ordinal + 1
                            val stepTitle = when (currentStep) {
                                VoiceRegistrationStep.Source -> stringResource(R.string.voices_step_source)
                                VoiceRegistrationStep.Identity -> stringResource(R.string.voices_step_identity)
                                VoiceRegistrationStep.Sharing -> stringResource(R.string.voices_step_sharing)
                            }
                            MutedText(stringResource(R.string.voices_step_indicator, stepIndex, stepTitle))
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
                                        notice = stringResource(R.string.voices_record_duration_notice),
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
                                            stringResource(R.string.voices_file_single_speaker_notice),
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
                                            uploadLabel = stringResource(R.string.voices_upload_file_or_video),
                                            notice = stringResource(R.string.voices_crop_duration_notice),
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
                                                                separatingBusy -> stringResource(R.string.voices_separating)
                                                                hasSeparatedSpeakers -> stringResource(R.string.voices_separate_done)
                                                                else -> stringResource(R.string.voices_separate_voices)
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
                                                        Text(stringResource(R.string.voices_reset))
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
                                            MutedText(stringResource(R.string.voices_select_to_register_hint))
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
                                        !promotingBusy && (canSubmitRecord || canSubmitSingleFile),
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

