package com.voicealarm.nativeapp

import android.Manifest
import android.content.pm.PackageManager
import android.media.MediaPlayer
import android.net.Uri
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
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.Pause
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.voicealarm.nativeapp.core.VoiceAlarmLog.TAG
import com.voicealarm.nativeapp.data.AlarmAudioStore
import com.voicealarm.nativeapp.data.AlarmVoiceRecorder
import com.voicealarm.nativeapp.data.CachedAlarmAudio
import com.voicealarm.nativeapp.data.VoiceProfileAudioLimits
import com.voicealarm.nativeapp.network.BillingSubscriptionResponse
import com.voicealarm.nativeapp.network.FamilyGroupCurrentResponse
import com.voicealarm.nativeapp.network.FamilyVoiceProfile
import com.voicealarm.nativeapp.network.TtsGenerateRequest
import com.voicealarm.nativeapp.network.TtsGenerateResponse
import com.voicealarm.nativeapp.network.VoiceProfile
import com.voicealarm.nativeapp.network.VoiceSpeakerSegment
import android.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private fun voiceProfilePlaceholder(): String = "알람 음성"

private fun speakerDurationLabel(speaker: VoiceSpeakerSegment): String =
    audioTimeLabel((speaker.endMs - speaker.startMs).coerceAtLeast(0L))

private fun voiceProfileDurationError(durationMillis: Long?): String? = when {
    durationMillis == null -> "오디오 길이를 확인할 수 없어요."
    durationMillis < VoiceProfileAudioLimits.MIN_DURATION_MILLIS -> "1분 이상 녹음해 주세요."
    durationMillis > VoiceProfileAudioLimits.MAX_DURATION_MILLIS -> "2분 이하 음성으로 등록할 수 있어요."
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
            MutedText("로그인 후 알람 음성을 만들 수 있어요.")
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
    onCreateVoiceProfile: (String, CachedAlarmAudio, Boolean) -> Unit,
    onCreateVoiceProfiles: (List<Triple<String, CachedAlarmAudio, Boolean>>) -> Unit,
    onSeparateVoiceSpeakers: suspend (CachedAlarmAudio) -> List<VoiceSpeakerSegment>,
    onCloneSpeakerDraft: suspend (String, CachedAlarmAudio) -> VoiceProfile,
    onPromoteDraftVoice: suspend (String) -> Unit,
    onDeleteDraftVoice: suspend (String) -> Unit,
    onGenerateTts: suspend (TtsGenerateRequest) -> TtsGenerateResponse,
    onRenameVoiceProfile: (String, String) -> Unit,
    onShareVoiceProfile: (String, Boolean) -> Unit,
    onDeleteVoiceProfile: (String) -> Unit,
    onOpenBilling: () -> Unit,
) {
    val context = LocalContext.current
    val appContext = context.applicationContext
    val audioStore = remember(appContext) { AlarmAudioStore(appContext) }
    val recorder = remember(appContext) { AlarmVoiceRecorder(appContext, audioStore) }
    val scope = rememberCoroutineScope()
    var profileName by remember { mutableStateOf("") }
    var shareVoice by remember { mutableStateOf(false) }
    var selectedAudio by remember { mutableStateOf<CachedAlarmAudio?>(null) }
    var localMessage by remember { mutableStateOf<String?>(null) }
    var inputMode by remember { mutableStateOf(VoiceCaptureMode.Record) }
    var isRecording by remember { mutableStateOf(false) }
    var recordingElapsedMillis by remember { mutableStateOf(0L) }
    var recordingLevels by remember { mutableStateOf(List(18) { 0.08f }) }
    var selectedFileUri by remember { mutableStateOf<Uri?>(null) }
    var selectedFileDurationMillis by remember { mutableStateOf<Long?>(null) }
    var cropStartMillis by remember { mutableStateOf(0L) }
    var cropEndMillis by remember { mutableStateOf(VoiceProfileAudioLimits.MAX_DURATION_MILLIS) }
    var speakerCount by remember { mutableStateOf(1) }
    var detectedSpeakers by remember { mutableStateOf<List<VoiceSpeakerSegment>>(emptyList()) }
    var speakerDraftStates by remember { mutableStateOf<Map<String, SpeakerDraftState>>(emptyMap()) }
    var activePlayingSpeakerId by remember { mutableStateOf<String?>(null) }
    var separatingBusy by remember { mutableStateOf(false) }
    var promotingBusy by remember { mutableStateOf(false) }
    var showCreateForm by remember { mutableStateOf(false) }
    var voicePlanGateOpen by remember { mutableStateOf(false) }
    var renameTarget by remember { mutableStateOf<VoiceProfile?>(null) }
    var renameName by remember { mutableStateOf("") }
    var deleteTarget by remember { mutableStateOf<VoiceProfile?>(null) }
    var mediaPlayer by remember { mutableStateOf<MediaPlayer?>(null) }
    var filePreviewPreparing by remember { mutableStateOf(false) }
    var filePreviewPlaying by remember { mutableStateOf(false) }
    val isLimitReached = voiceProfiles.size >= MAX_VOICE_PROFILES
    val canCreateVoice = hasPaidVoiceAccess(subscriptionResponse)
    val canShareVoice = hasCoupleOrFamilyAccess(subscriptionResponse, familyGroup)
    val paidVoiceRequiredMessage = "유료 요금제를 사용해야 목소리를 만들 수 있어요."

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
        speakerCount = 1
        detectedSpeakers = emptyList()
        // 다이얼로그 닫힐 때 현재 화면에 남은 draft 가 있으면 모두 삭제 (선택되지 않은 채 닫힘)
        cleanupDraftsAsync(speakerDraftStates.values.mapNotNull { it.profileId })
        speakerDraftStates = emptyMap()
        activePlayingSpeakerId = null
        separatingBusy = false
        promotingBusy = false
        profileName = ""
        shareVoice = false
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
        val cropDurationMillis = (cropEndMillis - cropStartMillis).coerceIn(1_000L, VoiceProfileAudioLimits.MAX_DURATION_MILLIS)
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
        index: Int,
        baseName: String,
        uri: Uri,
    ) {
        val duration = (speaker.endMs - speaker.startMs)
            .coerceIn(VoiceProfileAudioLimits.MIN_DURATION_MILLIS, VoiceProfileAudioLimits.MAX_DURATION_MILLIS)
        runCatching {
            val audio = withContext(Dispatchers.IO) {
                audioStore.cacheFromUri(
                    sourceUri = uri,
                    maxDurationMillis = duration,
                    startMillis = cropStartMillis + speaker.startMs,
                )
            }
            val draftName = "${baseName.ifBlank { voiceProfilePlaceholder() }} ${index + 1}"
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
                    text = "제 목소리를 선택하시는건가요?",
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
                    errorMessage = userFacingError(error, "화자 미리듣기 준비에 실패했어요."),
                )
            }
        }
    }

    fun separateSpeakers() {
        if (!canCreateVoice) {
            localMessage = paidVoiceRequiredMessage
            return
        }
        if (speakerCount <= 1) return
        val uri = selectedFileUri ?: return
        scope.launch {
            separatingBusy = true
            localMessage = null
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
                localMessage = if (visible.isEmpty()) "분리할 화자를 찾지 못했어요." else null
                val baseName = profileName.trim()
                visible.forEachIndexed { index, speaker ->
                    scope.launch { prepareSpeakerDraft(speaker, index, baseName, uri) }
                }
            }.onFailure { error ->
                Log.e(TAG, "Failed to separate speakers", error)
                localMessage = userFacingError(error, "화자 분리에 실패했어요.")
            }
            separatingBusy = false
        }
    }

    fun resetSpeakers() {
        cleanupDraftsAsync(speakerDraftStates.values.mapNotNull { it.profileId })
        detectedSpeakers = emptyList()
        speakerDraftStates = emptyMap()
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
            Log.e(TAG, "Failed to play speaker draft preview", error)
            localMessage = userFacingError(error, "미리듣기를 재생하지 못했어요.")
        }
    }

    fun selectSpeakerDraft(speaker: VoiceSpeakerSegment) {
        val state = speakerDraftStates[speaker.id] ?: return
        val selectedDraftId = state.profileId ?: return
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
                localMessage = "알람 음성으로 등록했어요"
            }.onFailure { error ->
                Log.e(TAG, "Failed to promote draft voice id=$selectedDraftId", error)
                localMessage = userFacingError(error, "알람 음성으로 등록하지 못했어요.")
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
        if (!canCreateVoice) {
            localMessage = paidVoiceRequiredMessage
            return
        }
        if (inputMode == VoiceCaptureMode.Record) {
            val audio = selectedAudio ?: return
            if (voiceProfileDurationError(audio.durationMillis) != null) return
            onCreateVoiceProfile(name, audio, shareVoice)
            closeCreateDialog()
            return
        }

        val uri = selectedFileUri ?: return
        val durationMillis = selectedFileDurationMillis ?: return
        if (voiceProfileFileDurationError(durationMillis) != null) return
        val selectedDurationMillis = cropEndMillis - cropStartMillis
        val selectedDurationError = voiceProfileDurationError(selectedDurationMillis)
        if (selectedDurationError != null) {
            localMessage = selectedDurationError
            return
        }
        if (speakerCount > 1) {
            // 화자 분리 모드에서는 카드의 "선택" 버튼으로 등록한다. (등록 버튼 비활성)
            return
        }
        scope.launch {
            runCatching {
                withContext(Dispatchers.IO) {
                    audioStore.cacheFromUri(
                        sourceUri = uri,
                        maxDurationMillis = selectedDurationMillis.coerceIn(
                            VoiceProfileAudioLimits.MIN_DURATION_MILLIS,
                            VoiceProfileAudioLimits.MAX_DURATION_MILLIS,
                        ),
                        startMillis = cropStartMillis,
                    )
                }
            }.onSuccess { audio ->
                onCreateVoiceProfile(name, audio, shareVoice)
                closeCreateDialog()
            }.onFailure { error ->
                Log.e(TAG, "Failed to prepare cropped voice profile audio", error)
                localMessage = userFacingError(error, "선택한 구간을 준비하지 못했어요.")
            }
        }
    }

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = "알람 음성",
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
            MutedText("아직 만든 알람 음성이 없어요.")
        } else if (voiceProfiles.isNotEmpty()) {
            voiceProfiles.forEach { profile ->
                VoiceProfileRow(
                    profile = profile,
                    enabled = !voiceProfileBusy,
                    canShareVoice = canShareVoice,
                    onRename = {
                        renameTarget = profile
                        renameName = profile.name
                    },
                    onShareChange = { shared -> onShareVoiceProfile(profile.id, shared) },
                    onDelete = { deleteTarget = profile },
                )
            }
        }

        if (canShareVoice && familyVoices.isNotEmpty()) {
            Text(
                text = "공유받은 알람 음성",
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
            )
            familyVoices.forEach { profile ->
                SharedVoiceProfileRow(profile = profile)
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
        val audio = selectedAudio
        val durationError = if (inputMode == VoiceCaptureMode.Record) {
            voiceProfileDurationError(audio?.durationMillis)
        } else {
            voiceProfileFileDurationError(selectedFileDurationMillis)
                ?: voiceProfileDurationError(cropEndMillis - cropStartMillis)
        }
        val resolvedProfileName = profileName.trim().ifBlank { voiceProfilePlaceholder() }
        val canRegister = if (inputMode == VoiceCaptureMode.Record) {
            audio != null && durationError == null
        } else if (speakerCount > 1) {
            // 화자 분리 모드에서는 카드의 "선택" 버튼으로 등록한다.
            false
        } else {
            selectedFileUri != null && durationError == null
        }
        AlertDialog(
            onDismissRequest = ::closeCreateDialog,
            title = { Text("알람 음성 만들기") },
            text = {
                Column(
                    modifier = Modifier
                        .heightIn(max = 560.dp)
                        .verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    OutlinedTextField(
                        value = profileName,
                        onValueChange = { profileName = it.take(50) },
                        label = { Text("알람 음성 이름") },
                        placeholder = { Text(voiceProfilePlaceholder()) },
                        singleLine = true,
                        shape = VocaWakeInputShape,
                        colors = vocaWakeOutlinedTextFieldColors(),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    if (canShareVoice) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text("알람 음성 공유", fontWeight = FontWeight.SemiBold)
                                MutedText(if (shareVoice) "상대가 선택할 수 있어요" else "나만 사용")
                            }
                            VoiceAlarmSwitch(
                                checked = shareVoice,
                                onCheckedChange = { shareVoice = it },
                            )
                        }
                    }
                    VoiceCaptureModeSelector(
                        selected = inputMode,
                        enabled = !isRecording,
                        onSelect = {
                            if (inputMode != it) stopMediaPreview()
                            inputMode = it
                        },
                    )

                    if (inputMode == VoiceCaptureMode.Record) {
                        VoiceCloneScriptExamples()
                        VoiceRecordControls(
                            isRecording = isRecording,
                            elapsedMillis = recordingElapsedMillis,
                            maxDurationMillis = VoiceProfileAudioLimits.MAX_DURATION_MILLIS,
                            levels = recordingLevels,
                            enabled = !voiceProfileBusy,
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
                            VoiceFileControls(
                                durationMillis = selectedFileDurationMillis,
                                cropStartMillis = cropStartMillis,
                                cropEndMillis = cropEndMillis,
                                minDurationMillis = VoiceProfileAudioLimits.MIN_DURATION_MILLIS,
                                maxDurationMillis = VoiceProfileAudioLimits.MAX_DURATION_MILLIS,
                                enabled = !voiceProfileBusy && !isRecording,
                                uploadLabel = "파일/영상 업로드",
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
                            selectedFileDurationMillis?.let {
                                SpeakerCountSelector(
                                    selected = speakerCount,
                                    onSelect = {
                                        speakerCount = it
                                        resetSpeakers()
                                    },
                                )
                                if (speakerCount > 1) {
                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                                    ) {
                                        Button(
                                            onClick = { separateSpeakers() },
                                            enabled = !separatingBusy && !promotingBusy,
                                            modifier = Modifier.weight(1f),
                                            shape = VocaWakeButtonShape,
                                        ) {
                                            Text(if (separatingBusy) "분리 중" else "화자 분리")
                                        }
                                        OutlinedButton(
                                            onClick = { resetSpeakers() },
                                            enabled = detectedSpeakers.isNotEmpty() && !promotingBusy,
                                            modifier = Modifier.weight(1f),
                                            shape = VocaWakeButtonShape,
                                            border = vocaWakeCardBorder(),
                                            colors = vocaWakeOutlinedButtonColors(),
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
                            }
                        }
                    }

                    if (localMessage != null) {
                        MutedText(localMessage.orEmpty())
                    }
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        submitCreateProfile(resolvedProfileName)
                    },
                    enabled = canRegister && !voiceProfileBusy && !isRecording,
                ) {
                    Text("등록")
                }
            },
            dismissButton = {
                TextButton(onClick = ::closeCreateDialog) {
                    Text("취소")
                }
            },
        )
    }

    renameTarget?.let { profile ->
        AlertDialog(
            onDismissRequest = { renameTarget = null },
            title = { Text("알람 음성 이름 변경") },
            text = {
                OutlinedTextField(
                    value = renameName,
                    onValueChange = { renameName = it.take(50) },
                    label = { Text("알람 음성 이름") },
                    singleLine = true,
                    shape = VocaWakeInputShape,
                    colors = vocaWakeOutlinedTextFieldColors(),
                    modifier = Modifier.fillMaxWidth(),
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        onRenameVoiceProfile(profile.id, renameName)
                        renameTarget = null
                    },
                    enabled = renameName.isNotBlank(),
                ) {
                    Text("저장")
                }
            },
            dismissButton = {
                TextButton(onClick = { renameTarget = null }) {
                    Text("취소")
                }
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
private fun VoiceCloneScriptExamples() {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text("녹음 예시", fontWeight = FontWeight.SemiBold)
        MutedText("아래 문장을 자연스럽게 읽고, 중간중간 쉬면서 평소 목소리를 유지해 주세요.")
        listOf(
            "좋은 아침이야. 이제 천천히 일어날 시간이야. 오늘도 무리하지 말고 같이 시작해 보자.",
            "오늘 하루도 정말 고생했어. 잠깐 숨을 고르고, 따뜻한 물 한 모금 마시면서 쉬어도 돼.",
            "내 목소리가 알람으로 들린다면 어떤 말이 가장 힘이 될지 생각하면서 편하게 말해볼게.",
        ).forEach { script ->
            MutedText("- $script")
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
            shape = VocaWakeCardShape,
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 0.dp,
            shadowElevation = 18.dp,
            border = vocaWakeCardBorder(),
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
                            text = "알람 음성 삭제",
                            style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.Bold,
                        )
                        MutedText("'$profileName' 알람 음성을 목록에서 삭제할까요?")
                    }
                    IconButton(
                        onClick = onDismiss,
                        modifier = Modifier.size(42.dp),
                    ) {
                        Icon(Icons.Outlined.Close, contentDescription = "닫기")
                    }
                }
                MutedText("이 알람 음성을 쓰는 메시지는 텍스트만 남고, 알람은 기본 알람음으로 바뀌어요. 서버에 저장된 음원은 함께 정리됩니다.")
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    OutlinedButton(
                        onClick = onDismiss,
                        modifier = Modifier.weight(1f),
                        shape = VocaWakeButtonShape,
                        border = vocaWakeCardBorder(),
                        colors = vocaWakeOutlinedButtonColors(),
                    ) {
                        Text("취소")
                    }
                    Button(
                        onClick = onDelete,
                        modifier = Modifier.weight(1f),
                        shape = VocaWakeButtonShape,
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
private fun VoiceInputModeButton(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    if (selected) {
        Button(
            onClick = onClick,
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

@Composable
private fun SpeakerCountSelector(
    selected: Int,
    onSelect: (Int) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            text = "화자 수",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            (1..3).forEach { count ->
                VoiceInputModeButton(
                    label = "${count}명",
                    selected = selected == count,
                    onClick = { onSelect(count) },
                    modifier = Modifier.weight(1f),
                )
            }
        }
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
    SpeakerDraftStatus.Cloning -> "목소리 학습 중"
    SpeakerDraftStatus.Synthesizing -> "미리듣기 음성 만드는 중"
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
    OutlinedCard(
        shape = VocaWakeCardShape,
        border = vocaWakeCardBorder(),
        colors = CardDefaults.outlinedCardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
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
                ) {
                    Text(
                        text = profile.name,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
                Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                    IconButton(onClick = onRename, enabled = enabled) {
                        Icon(Icons.Outlined.Edit, contentDescription = "수정")
                    }
                    IconButton(onClick = onDelete, enabled = enabled) {
                        Icon(Icons.Outlined.Delete, contentDescription = "삭제")
                    }
                }
            }
            if (canShareVoice) {
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(16.dp),
                    color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f),
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text("공유 허용", fontWeight = FontWeight.SemiBold)
                            MutedText(
                                if (profile.isShared == true) {
                                    "상대가 이 알람 음성을 선택할 수 있어요"
                                } else {
                                    "내 계정에서만 사용할게요"
                                },
                            )
                        }
                        VoiceAlarmSwitch(
                            checked = profile.isShared == true,
                            onCheckedChange = onShareChange,
                            enabled = enabled,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun SharedVoiceProfileRow(profile: FamilyVoiceProfile) {
    OutlinedCard(
        shape = VocaWakeCardShape,
        border = vocaWakeCardBorder(),
        colors = CardDefaults.outlinedCardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(14.dp),
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
                MutedText(profile.ownerName?.takeIf { it.isNotBlank() }?.let { "$it 님의 알람 음성" } ?: "공유받은 알람 음성")
            }
        }
    }
}
