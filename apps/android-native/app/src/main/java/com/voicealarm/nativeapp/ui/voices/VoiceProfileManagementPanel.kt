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
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
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
import com.voicealarm.nativeapp.network.BillingSubscriptionResponse
import com.voicealarm.nativeapp.network.FamilyGroupCurrentResponse
import com.voicealarm.nativeapp.network.FamilyVoiceProfile
import com.voicealarm.nativeapp.network.VoiceProfile
import com.voicealarm.nativeapp.network.VoiceSpeakerSegment
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private fun speakerDurationLabel(speaker: VoiceSpeakerSegment): String =
    audioTimeLabel((speaker.endMs - speaker.startMs).coerceAtLeast(0L))

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
    onCreateVoiceProfile: (String, CachedAlarmAudio, Boolean, String) -> Unit,
    onCreateVoiceProfiles: (List<VoiceProfileCreationDraft>) -> Unit,
    onSeparateVoiceSpeakers: suspend (CachedAlarmAudio) -> List<VoiceSpeakerSegment>,
    onRenameVoiceProfile: (String, String, String) -> Unit,
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
    var profileRelationship by remember { mutableStateOf("") }
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
    var fileWaveformLevels by remember { mutableStateOf<List<Float>>(emptyList()) }
    var fileWaveformLoading by remember { mutableStateOf(false) }
    var detectedSpeakers by remember { mutableStateOf<List<VoiceSpeakerSegment>>(emptyList()) }
    var selectedSpeakerIds by remember { mutableStateOf<Set<String>>(emptySet()) }
    var separatingBusy by remember { mutableStateOf(false) }
    var createPreparing by remember { mutableStateOf(false) }
    var createSubmitAttempted by remember { mutableStateOf(false) }
    var showCreateForm by remember { mutableStateOf(false) }
    var voicePlanGateOpen by remember { mutableStateOf(false) }
    var renameTarget by remember { mutableStateOf<VoiceProfile?>(null) }
    var renameName by remember { mutableStateOf("") }
    var renameRelationship by remember { mutableStateOf("") }
    var renameSubmitAttempted by remember { mutableStateOf(false) }
    var deleteTarget by remember { mutableStateOf<VoiceProfile?>(null) }
    var mediaPlayer by remember { mutableStateOf<MediaPlayer?>(null) }
    var filePreviewPreparing by remember { mutableStateOf(false) }
    var filePreviewPlaying by remember { mutableStateOf(false) }
    var activeSpeakerPreviewId by remember { mutableStateOf<String?>(null) }
    val isLimitReached = voiceProfiles.size >= MAX_VOICE_PROFILES
    val remainingProfileSlots = (MAX_VOICE_PROFILES - voiceProfiles.size).coerceAtLeast(0)
    val canCreateVoice = hasPaidVoiceAccess(subscriptionResponse)
    val canShareVoice = hasCoupleOrFamilyAccess(subscriptionResponse, familyGroup)
    val paidVoiceRequiredMessage = "유료 요금제를 사용해야 목소리를 만들 수 있어요."

    fun stopMediaPreview() {
        mediaPlayer?.release()
        mediaPlayer = null
        filePreviewPreparing = false
        filePreviewPlaying = false
        activeSpeakerPreviewId = null
    }

    fun applySelectedAudio(audio: CachedAlarmAudio) {
        stopMediaPreview()
        selectedAudio = audio
        localMessage = voiceProfileDurationError(audio.durationMillis)
    }

    fun loadSelectedFileWaveform(uri: Uri) {
        fileWaveformLevels = emptyList()
        fileWaveformLoading = true
        scope.launch {
            runCatching {
                withContext(Dispatchers.IO) {
                    audioStore.readWaveformLevels(uri, bins = 48)
                }
            }.onSuccess { levels ->
                if (selectedFileUri == uri) {
                    fileWaveformLevels = levels
                }
            }.onFailure { error ->
                Log.w(TAG, "Failed to read selected audio waveform", error)
            }
            if (selectedFileUri == uri) {
                fileWaveformLoading = false
            }
        }
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
                fileWaveformLevels = emptyList()
                cropStartMillis = 0L
                cropEndMillis = durationMillis.coerceAtMost(VoiceProfileAudioLimits.MAX_DURATION_MILLIS)
                detectedSpeakers = emptyList()
                selectedSpeakerIds = emptySet()
                localMessage = voiceProfileFileDurationError(durationMillis)
                loadSelectedFileWaveform(uri)
            }
                .onFailure { error ->
                    Log.e(TAG, "Failed to cache voice profile audio", error)
                    fileWaveformLoading = false
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

    fun closeCreateDialog() {
        if (recorder.isRecording) recorder.cancel()
        isRecording = false
        recordingElapsedMillis = 0L
        recordingLevels = List(18) { 0.08f }
        stopMediaPreview()
        selectedFileUri = null
        selectedFileDurationMillis = null
        fileWaveformLevels = emptyList()
        fileWaveformLoading = false
        cropStartMillis = 0L
        cropEndMillis = VoiceProfileAudioLimits.MAX_DURATION_MILLIS
        detectedSpeakers = emptyList()
        selectedSpeakerIds = emptySet()
        separatingBusy = false
        createPreparing = false
        createSubmitAttempted = false
        profileName = ""
        profileRelationship = ""
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

    fun separateSpeakers() {
        if (!canCreateVoice) {
            localMessage = paidVoiceRequiredMessage
            return
        }
        scope.launch {
            separatingBusy = true
            localMessage = null
            detectedSpeakers = emptyList()
            selectedSpeakerIds = emptySet()
            runCatching {
                val audio = croppedFileAudio()
                onSeparateVoiceSpeakers(audio)
            }.onSuccess { speakers ->
                val visibleSpeakers = speakers.filter { it.endMs > it.startMs }.take(3)
                detectedSpeakers = visibleSpeakers
                selectedSpeakerIds = visibleSpeakers
                    .take(remainingProfileSlots)
                    .mapTo(mutableSetOf()) { it.id }
                localMessage = if (detectedSpeakers.isEmpty()) "분리할 화자를 찾지 못했어요." else null
            }.onFailure { error ->
                Log.e(TAG, "Failed to separate speakers", error)
                localMessage = userFacingError(error, "화자 분리에 실패했어요.")
            }
            separatingBusy = false
        }
    }

    fun resetSpeakers() {
        detectedSpeakers = emptyList()
        selectedSpeakerIds = emptySet()
        stopMediaPreview()
        localMessage = null
    }

    fun playSpeakerPreview(speaker: VoiceSpeakerSegment) {
        val uri = selectedFileUri ?: return
        scope.launch {
            if (activeSpeakerPreviewId == speaker.id) {
                stopMediaPreview()
                return@launch
            }
            stopMediaPreview()
            runCatching {
                withContext(Dispatchers.IO) {
                    audioStore.cacheFromUri(
                        sourceUri = uri,
                        maxDurationMillis = (speaker.endMs - speaker.startMs)
                            .coerceIn(1_000L, VoiceProfileAudioLimits.MAX_DURATION_MILLIS),
                        startMillis = cropStartMillis + speaker.startMs,
                    )
                }
            }.onSuccess { audio ->
                mediaPlayer?.release()
                val player = MediaPlayer.create(context, Uri.parse(audio.localAudioUri))
                    ?: run {
                        localMessage = "미리듣기를 재생하지 못했어요."
                        return@onSuccess
                    }
                mediaPlayer = player.apply {
                    setOnCompletionListener {
                        it.release()
                        if (mediaPlayer === it) {
                            mediaPlayer = null
                            activeSpeakerPreviewId = null
                        }
                    }
                    start()
                }
                activeSpeakerPreviewId = speaker.id
            }.onFailure { error ->
                Log.e(TAG, "Failed to play speaker preview", error)
                localMessage = userFacingError(error, "미리듣기를 재생하지 못했어요.")
            }
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
        val trimmedRelationship = profileRelationship.trim()
        if (trimmedName.isBlank()) {
            localMessage = null
            return
        }
        if (trimmedRelationship.isBlank()) {
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
            onCreateVoiceProfile(trimmedName, audio, shareVoice, trimmedRelationship)
            closeCreateDialog()
            return
        }

        val uri = selectedFileUri ?: run {
            localMessage = "파일/영상을 먼저 업로드해 주세요."
            return
        }
        val durationMillis = selectedFileDurationMillis ?: run {
            localMessage = "오디오 길이를 확인할 수 없어요."
            return
        }
        if (voiceProfileFileDurationError(durationMillis) != null) return
        val selectedDurationMillis = cropEndMillis - cropStartMillis
        val selectedDurationError = voiceProfileDurationError(selectedDurationMillis)
        if (selectedDurationError != null) {
            localMessage = selectedDurationError
            return
        }
        if (detectedSpeakers.isEmpty()) {
            localMessage = "화자 분리를 먼저 진행해 주세요."
            return
        }
        val selectedSpeakers = detectedSpeakers.filter { it.id in selectedSpeakerIds }
        if (selectedSpeakers.isEmpty()) {
            localMessage = "등록할 화자를 선택해 주세요."
            return
        }
        if (selectedSpeakers.any { (it.endMs - it.startMs) < VoiceProfileAudioLimits.MIN_DURATION_MILLIS }) {
            localMessage = "알람 음성으로 만들 화자 구간은 1분 이상이어야 해요."
            return
        }
        createPreparing = true
        scope.launch {
            runCatching {
                selectedSpeakers.mapIndexed { index, speaker ->
                    val duration = speaker.endMs - speaker.startMs
                    val audio = withContext(Dispatchers.IO) {
                        audioStore.cacheFromUri(
                            sourceUri = uri,
                            maxDurationMillis = duration.coerceIn(1_000L, VoiceProfileAudioLimits.MAX_DURATION_MILLIS),
                            startMillis = cropStartMillis + speaker.startMs,
                        )
                    }
                    val resolvedName = if (selectedSpeakers.size == 1) {
                        trimmedName
                    } else {
                        "$trimmedName ${index + 1}"
                    }
                    VoiceProfileCreationDraft(
                        name = resolvedName,
                        audio = audio,
                        shared = shareVoice,
                        relationshipLabel = trimmedRelationship,
                    )
                }
            }.onSuccess { drafts ->
                onCreateVoiceProfiles(drafts)
                closeCreateDialog()
            }.onFailure { error ->
                createPreparing = false
                Log.e(TAG, "Failed to prepare selected speaker audio", error)
                localMessage = userFacingError(error, "선택한 화자 음성을 준비하지 못했어요.")
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
                        renameRelationship = profile.relationshipLabel.orEmpty()
                        renameSubmitAttempted = false
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
        val resolvedRelationship = profileRelationship.trim()
        val nameRequiredError = createSubmitAttempted && resolvedProfileName.isBlank()
        val relationshipRequiredError = createSubmitAttempted && resolvedRelationship.isBlank()
        val hasSeparatedSpeakers = detectedSpeakers.isNotEmpty()
        val fileInputLocked = separatingBusy || hasSeparatedSpeakers
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
                                text = "알람 음성 만들기",
                                style = MaterialTheme.typography.titleLarge,
                                fontWeight = FontWeight.Bold,
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
                        OutlinedTextField(
                            value = profileName,
                            onValueChange = { profileName = it.take(50) },
                            label = { Text("알람 음성 이름 (필수)") },
                            placeholder = { Text("예: 지우 목소리") },
                            singleLine = true,
                            isError = nameRequiredError,
                            supportingText = {
                                if (nameRequiredError) Text("필수 입력 값입니다.")
                            },
                            shape = VocaWakeInputShape,
                            colors = vocaWakeOutlinedTextFieldColors(),
                            modifier = Modifier.fillMaxWidth(),
                        )
                        OutlinedTextField(
                            value = profileRelationship,
                            onValueChange = { profileRelationship = it.take(30) },
                            label = { Text("나와의 관계 (필수)") },
                            placeholder = { Text("예: 손녀, 엄마, 연인") },
                            singleLine = true,
                            isError = relationshipRequiredError,
                            supportingText = {
                                if (relationshipRequiredError) Text("필수 입력 값입니다.")
                            },
                            shape = VocaWakeInputShape,
                            colors = vocaWakeOutlinedTextFieldColors(),
                            modifier = Modifier.fillMaxWidth(),
                        )
                        if (canShareVoice) {
                            Surface(
                                modifier = Modifier.fillMaxWidth(),
                                shape = RoundedCornerShape(18.dp),
                                color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f),
                            ) {
                                Row(
                                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
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
                        }
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
                                VoiceFileControls(
                                    durationMillis = selectedFileDurationMillis,
                                    cropStartMillis = cropStartMillis,
                                    cropEndMillis = cropEndMillis,
                                    minDurationMillis = VoiceProfileAudioLimits.MIN_DURATION_MILLIS,
                                    maxDurationMillis = VoiceProfileAudioLimits.MAX_DURATION_MILLIS,
                                    enabled = !voiceProfileBusy && !isRecording && !createPreparing && !fileInputLocked,
                                    uploadLabel = "파일/영상 업로드",
                                    notice = "1분 이상 2분 이하 구간을 선택해 주세요. 1분 30초를 권장해요.",
                                    isPreviewActive = filePreviewPlaying,
                                    isPreviewPreparing = filePreviewPreparing,
                                    waveformLevels = fileWaveformLevels,
                                    waveformLoading = fileWaveformLoading,
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
                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                                    ) {
                                        Button(
                                            onClick = { separateSpeakers() },
                                            enabled = !separatingBusy && !createPreparing && !hasSeparatedSpeakers,
                                            modifier = Modifier.weight(1f),
                                            shape = VocaWakeButtonShape,
                                        ) {
                                            Text(
                                                when {
                                                    separatingBusy -> "분리 중"
                                                    hasSeparatedSpeakers -> "분리 완료"
                                                    else -> "화자 분리"
                                                },
                                            )
                                        }
                                        OutlinedButton(
                                            onClick = { resetSpeakers() },
                                            enabled = hasSeparatedSpeakers && !createPreparing,
                                            modifier = Modifier.weight(1f),
                                            shape = VocaWakeButtonShape,
                                            border = vocaWakeCardBorder(),
                                            colors = vocaWakeOutlinedButtonColors(),
                                        ) {
                                            Text("초기화")
                                        }
                                    }
                                    detectedSpeakers.forEachIndexed { index, speaker ->
                                        val speakerSelected = speaker.id in selectedSpeakerIds
                                        SpeakerCandidateRow(
                                            speaker = speaker,
                                            index = index,
                                            selected = speakerSelected,
                                            playing = activeSpeakerPreviewId == speaker.id,
                                            canSelectMore = speakerSelected || selectedSpeakerIds.size < remainingProfileSlots,
                                            onToggle = {
                                                selectedSpeakerIds = if (speakerSelected) {
                                                    selectedSpeakerIds - speaker.id
                                                } else if (selectedSpeakerIds.size < remainingProfileSlots) {
                                                    selectedSpeakerIds + speaker.id
                                                } else {
                                                    selectedSpeakerIds
                                                }
                                            },
                                            onPreview = { playSpeakerPreview(speaker) },
                                        )
                                    }
                                }
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
                        Button(
                            onClick = { submitCreateProfile(resolvedProfileName) },
                            enabled = !voiceProfileBusy && !isRecording && !createPreparing,
                            modifier = Modifier.fillMaxWidth(),
                            shape = VocaWakeButtonShape,
                        ) {
                            Text(if (createPreparing) "준비 중" else "등록")
                        }
                    }
                }
            }
        }
    }

    renameTarget?.let { profile ->
        val resolvedRenameName = renameName.trim()
        val resolvedRenameRelationship = renameRelationship.trim()
        val renameNameError = renameSubmitAttempted && resolvedRenameName.isBlank()
        val renameRelationshipError = renameSubmitAttempted && resolvedRenameRelationship.isBlank()
        AlertDialog(
            onDismissRequest = { renameTarget = null },
            title = { Text("알람 음성 수정") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    OutlinedTextField(
                        value = renameName,
                        onValueChange = { renameName = it.take(50) },
                        label = { Text("알람 음성 이름") },
                        singleLine = true,
                        isError = renameNameError,
                        supportingText = {
                            if (renameNameError) Text("필수 입력 값입니다.")
                        },
                        shape = VocaWakeInputShape,
                        colors = vocaWakeOutlinedTextFieldColors(),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        value = renameRelationship,
                        onValueChange = { renameRelationship = it.take(30) },
                        label = { Text("나와의 관계") },
                        placeholder = { Text("예: 손녀, 엄마, 연인") },
                        singleLine = true,
                        isError = renameRelationshipError,
                        supportingText = {
                            if (renameRelationshipError) Text("필수 입력 값입니다.")
                        },
                        shape = VocaWakeInputShape,
                        colors = vocaWakeOutlinedTextFieldColors(),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        renameSubmitAttempted = true
                        if (resolvedRenameName.isNotBlank() && resolvedRenameRelationship.isNotBlank()) {
                            onRenameVoiceProfile(profile.id, resolvedRenameName, resolvedRenameRelationship)
                            renameTarget = null
                        }
                    },
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
private fun SpeakerCandidateRow(
    speaker: VoiceSpeakerSegment,
    index: Int,
    selected: Boolean,
    playing: Boolean,
    canSelectMore: Boolean,
    onToggle: () -> Unit,
    onPreview: () -> Unit,
) {
    OutlinedCard(
        border = vocaWakeCardBorder(),
        colors = CardDefaults.outlinedCardColors(
            containerColor = when {
                playing -> MaterialTheme.colorScheme.secondaryContainer.copy(alpha = 0.65f)
                selected -> MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.34f)
                else -> MaterialTheme.colorScheme.surface
            },
        ),
    ) {
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
                MutedText(speakerDurationLabel(speaker))
            }
            IconButton(onClick = onPreview) {
                Icon(Icons.Outlined.PlayArrow, contentDescription = "미리듣기")
            }
            if (playing) {
                Surface(
                    shape = RoundedCornerShape(999.dp),
                    color = MaterialTheme.colorScheme.secondary.copy(alpha = 0.18f),
                ) {
                    Text(
                        text = "재생 중",
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                        style = MaterialTheme.typography.bodySmall,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.secondary,
                    )
                }
            }
            if (selected) {
                Button(onClick = onToggle, shape = RoundedCornerShape(999.dp)) {
                    Text("선택됨")
                }
            } else {
                OutlinedButton(
                    onClick = onToggle,
                    enabled = canSelectMore,
                    shape = RoundedCornerShape(999.dp),
                ) {
                    Text("선택")
                }
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
                ) {
                    Text(
                        text = profile.name,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                    )
                    profile.relationshipLabel
                        ?.takeIf { it.isNotBlank() }
                        ?.let { MutedText("관계 · $it") }
                }
                when {
                    isProcessing -> VoiceProgressMessage("생성 중")
                    isDeleting -> VoiceProgressMessage("삭제 중")
                    else -> {
                        Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                            IconButton(onClick = onRename, enabled = rowEnabled) {
                                Icon(Icons.Outlined.Edit, contentDescription = "수정")
                            }
                            IconButton(onClick = onDelete, enabled = rowEnabled) {
                                Icon(Icons.Outlined.Delete, contentDescription = "삭제")
                            }
                        }
                    }
                }
            }
            if (canShareVoice && !isProcessing && !isDeleting) {
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
                            enabled = rowEnabled,
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
                val relation = profile.relationshipLabel?.takeIf { it.isNotBlank() }
                val ownerText = profile.ownerName?.takeIf { it.isNotBlank() }?.let { "$it 님의 알람 음성" } ?: "공유받은 알람 음성"
                MutedText(relation?.let { "$ownerText · 관계 $it" } ?: ownerText)
            }
        }
    }
}
