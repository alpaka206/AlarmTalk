package com.voicealarm.nativeapp

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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.Pause
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Slider
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.voicealarm.nativeapp.core.VoiceAlarmLog.TAG
import com.voicealarm.nativeapp.data.AlarmAudioStore
import com.voicealarm.nativeapp.data.AlarmVoiceRecorder
import com.voicealarm.nativeapp.data.CachedAlarmAudio
import com.voicealarm.nativeapp.data.VoiceProfileAudioLimits
import com.voicealarm.nativeapp.data.VoiceProfileCreationDraft
import com.voicealarm.nativeapp.network.apiErrorCode
import com.voicealarm.nativeapp.network.AuthSession
import com.voicealarm.nativeapp.network.BillingSubscriptionResponse
import com.voicealarm.nativeapp.network.FamilyGroupCurrentResponse
import com.voicealarm.nativeapp.network.FamilyVoiceProfile
import com.voicealarm.nativeapp.network.TtsGenerateRequest
import com.voicealarm.nativeapp.network.TtsGenerateResponse
import com.voicealarm.nativeapp.network.VoiceProfile
import com.voicealarm.nativeapp.network.VoiceSpeakerSegment
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
    val isLimitReached = voiceProfiles.size >= MAX_VOICE_PROFILES
    val canCreateVoice = hasPaidVoiceAccess(subscriptionResponse)
    val canShareVoice = canShareVoiceWithOthers(subscriptionResponse, familyGroup, authSession)
    val paidVoiceRequiredMessage = "유료 이용권에서 사용할 수 있어요."

    fun stopMediaPreview() {
        mediaPlayer?.release()
        mediaPlayer = null
        filePreviewPreparing = false
        filePreviewPlaying = false
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
            MutedText(paidVoiceRequiredMessage)
        }
        if (localMessage != null && !showCreateForm && localMessage != paidVoiceRequiredMessage) {
            MutedText(localMessage.orEmpty())
        }

        if (voiceProfiles.isEmpty() && canCreateVoice) {
            MutedText("아직 만든 목소리가 없어요.")
        } else if (voiceProfiles.isNotEmpty()) {
            voiceProfiles.forEach { profile ->
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
        val canSubmitRecord = inputMode == VoiceCaptureMode.Record
        val canSubmitSingleFile = inputMode == VoiceCaptureMode.File &&
            fileSpeakerMode == FileSpeakerMode.Single &&
            selectedFileUri != null
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
                                    VoiceRecordControls(
                                        isRecording = isRecording,
                                        elapsedMillis = recordingElapsedMillis,
                                        maxDurationMillis = VoiceProfileAudioLimits.MAX_DURATION_MILLIS,
                                        levels = recordingLevels,
                                        enabled = !voiceProfileBusy && !createPreparing,
                                        notice = "1분 이상 2분 이하로 녹음해 주세요. 1분 30초를 권장해요.",
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
                                            notice = "1분 이상 2분 이하 구간을 선택해 주세요. 1분 30초를 권장해요.",
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

@Composable
private fun VoiceProgressMessage(text: String) {
    Surface(
        shape = RoundedCornerShape(999.dp),
        color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.58f),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            CircularProgressIndicator(
                modifier = Modifier.size(14.dp),
                strokeWidth = 2.dp,
                color = MaterialTheme.colorScheme.onPrimaryContainer,
            )
            Text(
                text = text,
                style = MaterialTheme.typography.bodySmall,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onPrimaryContainer,
            )
        }
    }
}

@Composable
private fun VoiceProfileEditDialog(
    title: String,
    description: String,
    name: String,
    relationship: String,
    listenerTitle: String,
    nameError: Boolean,
    relationshipError: Boolean,
    listenerError: Boolean,
    onNameChange: (String) -> Unit,
    onRelationshipChange: (String) -> Unit,
    onListenerTitleChange: (String) -> Unit,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit,
) {
    VoiceFormDialog(
        title = title,
        description = description,
        onDismiss = onDismiss,
        onConfirm = onConfirm,
    ) {
        OutlinedTextField(
            value = name,
            onValueChange = onNameChange,
            label = { Text("목소리 이름") },
            singleLine = true,
            isError = nameError,
            supportingText = {
                if (nameError) Text("꼭 입력해 주세요.")
            },
            shape = WakerInputShape,
            colors = wakerOutlinedTextFieldColors(),
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = relationship,
            onValueChange = onRelationshipChange,
            label = { Text("나와의 관계") },
            placeholder = { Text("예: 손녀, 엄마, 연인") },
            singleLine = true,
            isError = relationshipError,
            supportingText = {
                if (relationshipError) Text("꼭 입력해 주세요.")
            },
            shape = WakerInputShape,
            colors = wakerOutlinedTextFieldColors(),
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = listenerTitle,
            onValueChange = onListenerTitleChange,
            label = { Text("이 목소리가 나를 부를 이름") },
            placeholder = { Text("예: 민지야, 여보") },
            singleLine = true,
            isError = listenerError,
            supportingText = {
                if (listenerError) Text("꼭 입력해 주세요.")
            },
            shape = WakerInputShape,
            colors = wakerOutlinedTextFieldColors(),
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
private fun SharedVoiceViewerInfoDialog(
    profileName: String,
    sharedFromLabel: String,
    initialRelationship: String,
    initialListenerTitle: String,
    onDismiss: () -> Unit,
    onConfirm: (String, String) -> Unit,
) {
    var draftRelationship by remember(initialRelationship) { mutableStateOf(initialRelationship) }
    var draftListener by remember(initialListenerTitle) { mutableStateOf(initialListenerTitle) }
    var submitted by remember { mutableStateOf(false) }
    val relationshipError = submitted && draftRelationship.isBlank()
    val listenerError = submitted && draftListener.isBlank()

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
                .widthIn(max = 460.dp),
            shape = WakerCardShape,
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 0.dp,
            shadowElevation = 18.dp,
            border = wakerCardBorder(),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(max = 620.dp)
                    .verticalScroll(rememberScrollState())
                    .padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalAlignment = Alignment.Top,
                ) {
                    Column(
                        modifier = Modifier.weight(1f),
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        Text(
                            text = "공유받은 목소리 설정",
                            style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.Bold,
                        )
                        Text(
                            text = "알람에서 이 목소리가 나를 어떻게 부를지 정해요.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    IconButton(
                        onClick = onDismiss,
                        modifier = Modifier.size(42.dp),
                    ) {
                        Icon(Icons.Outlined.Close, contentDescription = "닫기")
                    }
                }
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(18.dp),
                    color = MaterialTheme.colorScheme.secondaryContainer.copy(alpha = 0.45f),
                    border = wakerCardBorder(),
                ) {
                    Row(
                        modifier = Modifier.padding(14.dp),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(
                            modifier = Modifier
                                .size(42.dp)
                                .background(MaterialTheme.colorScheme.surface, CircleShape),
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(
                                imageVector = Icons.Outlined.Mic,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.onSecondaryContainer,
                            )
                        }
                        Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                            Text(
                                text = profileName,
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.Bold,
                                color = MaterialTheme.colorScheme.onSecondaryContainer,
                            )
                            Text(
                                text = sharedFromLabel,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSecondaryContainer.copy(alpha = 0.76f),
                            )
                        }
                    }
                }
                OutlinedTextField(
                    value = draftRelationship,
                    onValueChange = { draftRelationship = it.take(30) },
                    label = { Text("나와의 관계") },
                    placeholder = { Text("예: 손주, 자식, 형제") },
                    singleLine = true,
                    isError = relationshipError,
                    supportingText = {
                        if (relationshipError) Text("꼭 입력해 주세요.")
                    },
                    shape = WakerInputShape,
                    colors = wakerOutlinedTextFieldColors(),
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = draftListener,
                    onValueChange = { draftListener = it.take(30) },
                    label = { Text("이 목소리가 나를 부를 이름") },
                    placeholder = { Text("예: 지호야, 여보") },
                    singleLine = true,
                    isError = listenerError,
                    supportingText = {
                        if (listenerError) Text("꼭 입력해 주세요.")
                    },
                    shape = WakerInputShape,
                    colors = wakerOutlinedTextFieldColors(),
                    modifier = Modifier.fillMaxWidth(),
                )
                Button(
                    onClick = {
                        submitted = true
                        if (draftRelationship.isNotBlank() && draftListener.isNotBlank()) {
                            onConfirm(draftRelationship.trim(), draftListener.trim())
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                    shape = WakerButtonShape,
                ) {
                    Text("저장")
                }
            }
        }
    }
}

@Composable
private fun VoiceFormDialog(
    title: String,
    description: String,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit,
    content: @Composable () -> Unit,
) {
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp),
            shape = WakerCardShape,
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 0.dp,
            shadowElevation = 18.dp,
            border = wakerCardBorder(),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalAlignment = Alignment.Top,
                ) {
                    Column(
                        modifier = Modifier.weight(1f),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Text(
                            text = title,
                            style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.Bold,
                        )
                        MutedText(description)
                    }
                    IconButton(
                        onClick = onDismiss,
                        modifier = Modifier.size(42.dp),
                    ) {
                        Icon(Icons.Outlined.Close, contentDescription = "닫기")
                    }
                }
                Column(
                    modifier = Modifier.fillMaxWidth(),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    content()
                }
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Button(
                        onClick = onConfirm,
                        modifier = Modifier.fillMaxWidth(),
                        shape = WakerButtonShape,
                    ) {
                        Text("저장")
                    }
                }
            }
        }
    }
}

@Composable
private fun VoiceProfileDeleteDialog(
    profileName: String,
    onDismiss: () -> Unit,
    onDelete: () -> Unit,
) {
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp),
            shape = WakerCardShape,
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 0.dp,
            shadowElevation = 18.dp,
            border = wakerCardBorder(),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalAlignment = Alignment.Top,
                ) {
                    Column(
                        modifier = Modifier.weight(1f),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Text(
                            text = "목소리 삭제",
                            style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.Bold,
                        )
                        MutedText("'$profileName' 목소리를 삭제할까요?")
                    }
                    IconButton(
                        onClick = onDismiss,
                        modifier = Modifier.size(42.dp),
                    ) {
                        Icon(Icons.Outlined.Close, contentDescription = "닫기")
                    }
                }
                MutedText("이 목소리를 쓰는 메시지는 텍스트만 남고, 알람은 기본 알람음으로 바뀌어요. 저장된 음원 파일도 함께 삭제돼요.")
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Button(
                        onClick = onDelete,
                        modifier = Modifier.fillMaxWidth(),
                        shape = WakerButtonShape,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = MaterialTheme.colorScheme.error,
                            contentColor = MaterialTheme.colorScheme.onError,
                        ),
                    ) {
                        Text("삭제")
                    }
                }
            }
        }
    }
}

@Composable
private fun FileSpeakerModeSelector(
    selected: FileSpeakerMode,
    enabled: Boolean,
    onSelect: (FileSpeakerMode) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("파일 속 목소리", fontWeight = FontWeight.SemiBold)
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            FileSpeakerModeButton(
                label = "1명",
                selected = selected == FileSpeakerMode.Single,
                enabled = enabled,
                onClick = { onSelect(FileSpeakerMode.Single) },
                modifier = Modifier.weight(1f),
            )
            FileSpeakerModeButton(
                label = "2명 이상",
                selected = selected == FileSpeakerMode.Multiple,
                enabled = enabled,
                onClick = { onSelect(FileSpeakerMode.Multiple) },
                modifier = Modifier.weight(1f),
            )
        }
    }
}

@Composable
private fun FileSpeakerModeButton(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    if (selected) {
        Button(
            onClick = onClick,
            enabled = enabled,
            modifier = modifier,
            shape = RoundedCornerShape(999.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = MaterialTheme.colorScheme.secondary,
                contentColor = MaterialTheme.colorScheme.onSecondary,
            ),
        ) {
            Text(label)
        }
    } else {
        OutlinedButton(
            onClick = onClick,
            enabled = enabled,
            modifier = modifier,
            shape = RoundedCornerShape(999.dp),
        ) {
            Text(label)
        }
    }
}

@Composable
private fun RecordingLevelBars(
    levels: List<Float>,
    active: Boolean,
) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(3.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        levels.forEachIndexed { index, level ->
            val resolvedLevel = if (active) level else 0.1f + (index % 4) * 0.04f
            Box(
                modifier = Modifier
                    .width(4.dp)
                    .height((10 + resolvedLevel * 34).dp)
                    .background(
                        if (active) {
                            MaterialTheme.colorScheme.error
                        } else {
                            MaterialTheme.colorScheme.outlineVariant
                        },
                        RoundedCornerShape(999.dp),
                    ),
            )
        }
    }
}

internal enum class FileSpeakerMode {
    Single,
    Multiple,
}

internal enum class VoiceRegistrationStep {
    Source,
    Identity,
    Sharing,
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun RelationshipDropdownField(
    selection: RelationshipSelection,
    onSelectionChange: (RelationshipSelection) -> Unit,
    isError: Boolean,
) {
    var expanded by remember { mutableStateOf(false) }
    val presetLabel = selection.preset?.label.orEmpty()
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        ExposedDropdownMenuBox(
            expanded = expanded,
            onExpandedChange = { expanded = !expanded },
            modifier = Modifier.fillMaxWidth(),
        ) {
            OutlinedTextField(
                value = presetLabel,
                onValueChange = {},
                readOnly = true,
                label = { Text("나와의 관계 (필수)") },
                placeholder = { Text("관계를 선택해 주세요") },
                trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
                isError = isError && !selection.isComplete,
                supportingText = {
                    if (isError && !selection.isComplete) Text("꼭 입력해 주세요.")
                },
                shape = WakerInputShape,
                colors = wakerOutlinedTextFieldColors(),
                modifier = Modifier
                    .fillMaxWidth()
                    .menuAnchor(),
            )
            ExposedDropdownMenu(
                expanded = expanded,
                onDismissRequest = { expanded = false },
            ) {
                val relationshipOptions = listOf(RelationshipPreset.Custom) +
                    RelationshipPreset.entries.filterNot { it == RelationshipPreset.Custom }
                relationshipOptions.forEach { preset ->
                    DropdownMenuItem(
                        text = { Text(preset.label) },
                        onClick = {
                            expanded = false
                            onSelectionChange(
                                if (preset == RelationshipPreset.Custom) {
                                    selection.copy(preset = preset)
                                } else {
                                    RelationshipSelection(preset = preset, customLabel = "")
                                },
                            )
                        },
                    )
                }
            }
        }
        if (selection.preset == RelationshipPreset.Custom) {
            OutlinedTextField(
                value = selection.customLabel,
                onValueChange = {
                    onSelectionChange(selection.copy(customLabel = it.take(30)))
                },
                label = { Text("관계 직접 입력") },
                placeholder = { Text("예: 손녀, 연인, 동료") },
                singleLine = true,
                isError = isError && !selection.isComplete,
                supportingText = {
                    if (isError && !selection.isComplete) Text("꼭 입력해 주세요.")
                },
                shape = WakerInputShape,
                colors = wakerOutlinedTextFieldColors(),
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@Composable
private fun ListenerTitlePreview(
    listenerTitle: String,
    relationshipLabel: String,
) {
    if (listenerTitle.isBlank()) return
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = WakerCardShape,
        color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.55f),
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(
                text = "이 목소리는 이렇게 불러줘요",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onPrimaryContainer,
            )
            Text(
                text = "\"$listenerTitle, 일어날 시간이에요\"",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onPrimaryContainer,
            )
            if (relationshipLabel.isNotBlank()) {
                MutedText("관계 · $relationshipLabel")
            }
        }
    }
}

@Composable
private fun SharingOptionCard(
    enabled: Boolean,
    title: String,
    description: String,
    isChosen: Boolean,
    onClick: () -> Unit,
) {
    val containerColor = if (isChosen) {
        MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.55f)
    } else {
        MaterialTheme.colorScheme.surface
    }
    OutlinedCard(
        shape = WakerCardShape,
        border = wakerCardBorder(if (enabled) 1f else 0.4f),
        colors = CardDefaults.outlinedCardColors(containerColor = containerColor),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            RadioButton(
                selected = isChosen,
                onClick = onClick,
                enabled = enabled,
            )
            Column(modifier = Modifier.weight(1f)) {
                Text(title, fontWeight = FontWeight.SemiBold)
                MutedText(description)
            }
        }
    }
}

internal enum class RelationshipPreset(val label: String) {
    Mom("엄마"),
    Dad("아빠"),
    Grandma("할머니"),
    Grandpa("할아버지"),
    Son("아들"),
    Daughter("딸"),
    Granddaughter("손녀"),
    Grandson("손주"),
    Sibling("형제·자매"),
    Boyfriend("남자친구"),
    Girlfriend("여자친구"),
    Husband("남편"),
    Wife("아내"),
    Friend("친구"),
    Celebrity("연예인"),
    Custom("직접 입력"),
}

internal data class RelationshipSelection(
    val preset: RelationshipPreset? = null,
    val customLabel: String = "",
) {
    val resolved: String
        get() = when (preset) {
            null -> ""
            RelationshipPreset.Custom -> customLabel.trim()
            else -> preset.label
        }

    val isComplete: Boolean
        get() = resolved.isNotBlank()
}

internal fun parseRelationshipLabel(raw: String?): RelationshipSelection {
    val trimmed = raw?.trim().orEmpty()
    if (trimmed.isEmpty()) return RelationshipSelection()
    val match = RelationshipPreset.entries.firstOrNull {
        it != RelationshipPreset.Custom && it.label == trimmed
    }
    return if (match != null) {
        RelationshipSelection(preset = match)
    } else {
        RelationshipSelection(preset = RelationshipPreset.Custom, customLabel = trimmed)
    }
}

internal enum class SpeakerDraftStatus {
    Cloning,
    Synthesizing,
    Ready,
    Failed,
}

internal data class SpeakerDraftState(
    val profileId: String? = null,
    val previewUri: String? = null,
    val status: SpeakerDraftStatus = SpeakerDraftStatus.Cloning,
    val errorMessage: String? = null,
)

private fun draftStatusLabel(status: SpeakerDraftStatus, errorMessage: String?): String = when (status) {
    SpeakerDraftStatus.Cloning -> "목소리를 만드는 중"
    SpeakerDraftStatus.Synthesizing -> "미리듣기를 만드는 중"
    SpeakerDraftStatus.Ready -> "준비 완료"
    SpeakerDraftStatus.Failed -> errorMessage ?: "미리듣기를 준비하지 못했어요"
}

@Composable
private fun SpeakerDraftRow(
    speaker: VoiceSpeakerSegment,
    index: Int,
    state: SpeakerDraftState,
    isPlaying: Boolean,
    promotingBusy: Boolean,
    onTogglePlay: () -> Unit,
    onSelect: () -> Unit,
) {
    val ready = state.status == SpeakerDraftStatus.Ready && state.previewUri != null
    OutlinedCard {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = "목소리 ${index + 1}",
                    fontWeight = FontWeight.SemiBold,
                )
                MutedText(draftStatusLabel(state.status, state.errorMessage))
            }
            IconButton(
                onClick = onTogglePlay,
                enabled = ready,
            ) {
                Icon(
                    imageVector = if (isPlaying) Icons.Outlined.Pause else Icons.Outlined.PlayArrow,
                    contentDescription = if (isPlaying) "일시정지" else "미리듣기",
                )
            }
            Button(
                onClick = onSelect,
                enabled = ready && !promotingBusy,
                shape = RoundedCornerShape(999.dp),
            ) {
                Text("선택")
            }
        }
    }
}

@Composable
internal fun VoiceProfileRow(
    profile: VoiceProfile,
    enabled: Boolean,
    canShareVoice: Boolean,
    onRename: () -> Unit,
    onShareChange: (Boolean) -> Unit,
    onDelete: () -> Unit,
) {
    val isProcessing = profile.status == "processing"
    val isDeleting = profile.status == "deleting"
    val rowEnabled = enabled && !isProcessing && !isDeleting
    var menuExpanded by remember { mutableStateOf(false) }
    val isShared = profile.isShared == true
    OutlinedCard(
        shape = WakerCardShape,
        border = wakerCardBorder(),
        colors = CardDefaults.outlinedCardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    modifier = Modifier
                        .size(42.dp)
                        .background(
                            if (isDeleting) {
                                MaterialTheme.colorScheme.surfaceVariant
                            } else {
                                MaterialTheme.colorScheme.secondaryContainer
                            },
                            CircleShape,
                        ),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        imageVector = Icons.Outlined.Mic,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSecondaryContainer,
                    )
                }
                Column(
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(3.dp),
                ) {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            text = profile.name,
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.SemiBold,
                            modifier = Modifier.weight(1f, fill = false),
                        )
                        if (canShareVoice && isShared && !isProcessing && !isDeleting) {
                            VoiceSharedBadge()
                        }
                    }
                }
                when {
                    isProcessing -> VoiceProgressMessage("생성 중")
                    isDeleting -> VoiceProgressMessage("삭제 중")
                    else -> {
                        Box {
                            IconButton(
                                onClick = { menuExpanded = true },
                                enabled = rowEnabled,
                            ) {
                                Icon(Icons.Outlined.MoreVert, contentDescription = "더보기")
                            }
                            DropdownMenu(
                                expanded = menuExpanded,
                                onDismissRequest = { menuExpanded = false },
                            ) {
                                DropdownMenuItem(
                                    text = { Text("정보 수정") },
                                    leadingIcon = { Icon(Icons.Outlined.Edit, contentDescription = null) },
                                    onClick = {
                                        menuExpanded = false
                                        onRename()
                                    },
                                )
                                DropdownMenuItem(
                                    text = { Text("삭제") },
                                    leadingIcon = { Icon(Icons.Outlined.Delete, contentDescription = null) },
                                    onClick = {
                                        menuExpanded = false
                                        onDelete()
                                    },
                                )
                            }
                        }
                    }
                }
            }

            if (!isProcessing && !isDeleting) {
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(16.dp),
                    color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.42f),
                    border = wakerCardBorder(if (canShareVoice) 0.72f else 0.36f),
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(
                            modifier = Modifier.weight(1f),
                            verticalArrangement = Arrangement.spacedBy(3.dp),
                        ) {
                            Text(
                                text = "목소리 공유",
                                style = MaterialTheme.typography.bodyMedium,
                                fontWeight = FontWeight.SemiBold,
                            )
                        }
                        VoiceAlarmSwitch(
                            checked = isShared,
                            onCheckedChange = onShareChange,
                            enabled = rowEnabled && canShareVoice,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun VoiceSharedBadge() {
    Surface(
        shape = RoundedCornerShape(999.dp),
        color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.65f),
    ) {
        Text(
            text = "공유 중",
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onPrimaryContainer,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
        )
    }
}

@Composable
private fun SharedVoiceProfileRow(
    profile: FamilyVoiceProfile,
    onEdit: () -> Unit,
) {
    val needsViewerInfo = profile.requiresViewerInfo()
    OutlinedCard(
        shape = WakerCardShape,
        border = wakerCardBorder(),
        colors = CardDefaults.outlinedCardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    modifier = Modifier
                        .size(42.dp)
                        .background(MaterialTheme.colorScheme.secondaryContainer, CircleShape),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        imageVector = Icons.Outlined.Mic,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSecondaryContainer,
                    )
                }
                Column(
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(3.dp),
                ) {
                    Text(profile.name, fontWeight = FontWeight.SemiBold)
                    val ownerText = profile.ownerName?.takeIf { it.isNotBlank() }
                        ?.let { "${it}님에게 공유받은 목소리" } ?: "공유받은 목소리"
                    MutedText(ownerText)
                }
                IconButton(onClick = onEdit) {
                    Icon(Icons.Outlined.Edit, contentDescription = "내 정보 수정")
                }
            }
            if (needsViewerInfo) {
                OutlinedButton(
                    onClick = onEdit,
                    modifier = Modifier.fillMaxWidth(),
                    shape = WakerButtonShape,
                    border = wakerCardBorder(),
                    colors = wakerOutlinedButtonColors(),
                ) {
                    Text("이 목소리가 나를 어떻게 부를지 설정")
                }
            }
        }
    }
}

