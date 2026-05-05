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
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
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
import com.voicealarm.nativeapp.core.VoiceAlarmLog.TAG
import com.voicealarm.nativeapp.data.AlarmAudioStore
import com.voicealarm.nativeapp.data.AlarmVoiceRecorder
import com.voicealarm.nativeapp.data.CachedAlarmAudio
import com.voicealarm.nativeapp.data.VoiceProfileAudioLimits
import com.voicealarm.nativeapp.network.BillingSubscriptionResponse
import com.voicealarm.nativeapp.network.FamilyGroupCurrentResponse
import com.voicealarm.nativeapp.network.VoiceProfile
import com.voicealarm.nativeapp.network.VoiceSpeakerSegment
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private fun voiceProfilePlaceholder(existingCount: Int): String = "음성${existingCount + 1}"

private fun speakerDurationLabel(speaker: VoiceSpeakerSegment): String =
    audioTimeLabel((speaker.endMs - speaker.startMs).coerceAtLeast(0L))

private fun voiceProfileDurationError(durationMillis: Long?): String? = when {
    durationMillis == null -> "오디오 길이를 확인할 수 없어요"
    durationMillis < VoiceProfileAudioLimits.MIN_DURATION_MILLIS -> "30초 이상 녹음해 주세요"
    durationMillis > VoiceProfileAudioLimits.MAX_DURATION_MILLIS -> "1분 이하 음성만 등록할 수 있어요"
    else -> null
}

private fun voiceProfileFileDurationError(durationMillis: Long?): String? = when {
    durationMillis == null -> "오디오 길이를 확인할 수 없어요"
    durationMillis < VoiceProfileAudioLimits.MIN_DURATION_MILLIS -> "30초 이상인 파일을 선택해 주세요"
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
            MutedText("음성 프로필은 계정에 저장됩니다. 홈 탭에서 로그인한 뒤 다시 열어 주세요.")
        }
    }
}

@Composable
internal fun VoiceProfileManagementPanel(
    voiceProfiles: List<VoiceProfile>,
    voiceProfileBusy: Boolean,
    subscriptionResponse: BillingSubscriptionResponse?,
    familyGroup: FamilyGroupCurrentResponse?,
    onCreateVoiceProfile: (String, CachedAlarmAudio, Boolean) -> Unit,
    onCreateVoiceProfiles: (List<Triple<String, CachedAlarmAudio, Boolean>>) -> Unit,
    onSeparateVoiceSpeakers: suspend (CachedAlarmAudio) -> List<VoiceSpeakerSegment>,
    onRenameVoiceProfile: (String, String) -> Unit,
    onDeleteVoiceProfile: (String) -> Unit,
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
    var selectedSpeakerIds by remember { mutableStateOf<Set<String>>(emptySet()) }
    var removedSpeakerIds by remember { mutableStateOf<Set<String>>(emptySet()) }
    var separatingBusy by remember { mutableStateOf(false) }
    var showCreateForm by remember { mutableStateOf(false) }
    var renameTarget by remember { mutableStateOf<VoiceProfile?>(null) }
    var renameName by remember { mutableStateOf("") }
    var deleteTarget by remember { mutableStateOf<VoiceProfile?>(null) }
    var mediaPlayer by remember { mutableStateOf<MediaPlayer?>(null) }
    val isLimitReached = voiceProfiles.size >= MAX_VOICE_PROFILES
    val remainingProfileSlots = (MAX_VOICE_PROFILES - voiceProfiles.size).coerceAtLeast(0)
    val canShareVoice = hasCoupleOrFamilyAccess(subscriptionResponse, familyGroup)

    fun applySelectedAudio(audio: CachedAlarmAudio) {
        selectedAudio = audio
        localMessage = voiceProfileDurationError(audio.durationMillis)
    }

    fun prepareSelectedFile(uri: Uri) {
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
                selectedSpeakerIds = emptySet()
                removedSpeakerIds = emptySet()
                localMessage = voiceProfileFileDurationError(durationMillis)
            }
                .onFailure { error ->
                    Log.e(TAG, "Failed to cache voice profile audio", error)
                    localMessage = userFacingError(error, "선택한 오디오를 사용할 수 없어요")
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
                localMessage = userFacingError(error, "녹음에 실패했어요")
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
            localMessage = userFacingError(error, "녹음을 시작할 수 없어요")
        }
    }

    fun closeCreateDialog() {
        if (recorder.isRecording) recorder.cancel()
        isRecording = false
        recordingElapsedMillis = 0L
        recordingLevels = List(18) { 0.08f }
        selectedFileUri = null
        selectedFileDurationMillis = null
        cropStartMillis = 0L
        cropEndMillis = VoiceProfileAudioLimits.MAX_DURATION_MILLIS
        speakerCount = 1
        detectedSpeakers = emptyList()
        selectedSpeakerIds = emptySet()
        removedSpeakerIds = emptySet()
        separatingBusy = false
        profileName = ""
        shareVoice = false
        selectedAudio = null
        mediaPlayer?.release()
        mediaPlayer = null
        showCreateForm = false
        localMessage = null
    }

    val pickAudioLauncher = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) prepareSelectedFile(uri)
    }
    val recordPermissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) {
            startRecording()
        } else {
            localMessage = "마이크 권한이 필요해요"
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

    DisposableEffect(Unit) {
        onDispose {
            if (recorder.isRecording) recorder.cancel()
            mediaPlayer?.release()
        }
    }

    suspend fun croppedFileAudio(): CachedAlarmAudio {
        val uri = selectedFileUri ?: throw IllegalStateException("파일을 선택해 주세요")
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
        if (speakerCount <= 1) return
        scope.launch {
            separatingBusy = true
            localMessage = null
            runCatching {
                val audio = croppedFileAudio()
                onSeparateVoiceSpeakers(audio)
            }.onSuccess { speakers ->
                detectedSpeakers = speakers.filter { it.endMs > it.startMs }.take(3)
                selectedSpeakerIds = emptySet()
                removedSpeakerIds = emptySet()
                localMessage = if (detectedSpeakers.isEmpty()) "분리된 화자를 찾지 못했어요" else null
            }.onFailure { error ->
                Log.e(TAG, "Failed to separate speakers", error)
                localMessage = userFacingError(error, "화자 분리에 실패했어요")
            }
            separatingBusy = false
        }
    }

    fun resetSpeakers() {
        detectedSpeakers = emptyList()
        selectedSpeakerIds = emptySet()
        removedSpeakerIds = emptySet()
        localMessage = null
    }

    fun playSpeakerPreview(speaker: VoiceSpeakerSegment) {
        val uri = selectedFileUri ?: return
        scope.launch {
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
                mediaPlayer = MediaPlayer.create(context, Uri.parse(audio.localAudioUri))?.apply {
                    setOnCompletionListener {
                        it.release()
                        if (mediaPlayer === it) mediaPlayer = null
                    }
                    start()
                }
            }.onFailure { error ->
                Log.e(TAG, "Failed to play speaker preview", error)
                localMessage = userFacingError(error, "미리듣기를 재생하지 못했어요")
            }
        }
    }

    fun playFileCropPreview() {
        scope.launch {
            runCatching {
                croppedFileAudio()
            }.onSuccess { audio ->
                mediaPlayer?.release()
                mediaPlayer = MediaPlayer.create(context, Uri.parse(audio.localAudioUri))?.apply {
                    setOnCompletionListener {
                        it.release()
                        if (mediaPlayer === it) mediaPlayer = null
                    }
                    start()
                }
            }.onFailure { error ->
                Log.e(TAG, "Failed to play cropped voice preview", error)
                localMessage = userFacingError(error, "선택한 구간을 재생하지 못했어요")
            }
        }
    }

    fun submitCreateProfile(name: String) {
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
            val selectedSpeakers = detectedSpeakers.filter { it.id in selectedSpeakerIds }
            if (selectedSpeakers.isEmpty()) {
                localMessage = "등록할 화자를 선택해 주세요"
                return
            }
            if (selectedSpeakers.any { (it.endMs - it.startMs) < VoiceProfileAudioLimits.MIN_DURATION_MILLIS }) {
                localMessage = "프로필로 만들 화자 음성은 30초 이상이어야 해요"
                return
            }
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
                            name
                        } else {
                            "$name ${index + 1}"
                        }
                        Triple(resolvedName, audio, shareVoice)
                    }
                }.onSuccess { drafts ->
                    onCreateVoiceProfiles(drafts)
                    closeCreateDialog()
                }.onFailure { error ->
                    Log.e(TAG, "Failed to prepare selected speaker audio", error)
                    localMessage = userFacingError(error, "선택한 화자 음성을 준비하지 못했어요")
                }
            }
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
                localMessage = userFacingError(error, "선택한 구간을 준비하지 못했어요")
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
                text = "프로필 목록 (${voiceProfiles.size}/${MAX_VOICE_PROFILES})",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
            Button(
                onClick = { showCreateForm = true },
                enabled = !voiceProfileBusy && !isLimitReached,
            ) {
                Text("추가")
            }
        }

        if (isLimitReached) {
            MutedText("음성 프로필은 최대 ${MAX_VOICE_PROFILES}개까지 만들 수 있어요.")
        }

        if (voiceProfiles.isEmpty()) {
            MutedText("아직 만든 음성 프로필이 없어요.")
        } else {
            voiceProfiles.forEach { profile ->
                VoiceProfileRow(
                    profile = profile,
                    enabled = !voiceProfileBusy,
                    onRename = {
                        renameTarget = profile
                        renameName = profile.name
                    },
                    onDelete = { deleteTarget = profile },
                )
            }
        }
    }

    if (showCreateForm && !isLimitReached) {
        val audio = selectedAudio
        val durationError = if (inputMode == VoiceCaptureMode.Record) {
            voiceProfileDurationError(audio?.durationMillis)
        } else {
            voiceProfileFileDurationError(selectedFileDurationMillis)
                ?: voiceProfileDurationError(cropEndMillis - cropStartMillis)
        }
        val resolvedProfileName = profileName.trim().ifBlank { voiceProfilePlaceholder(voiceProfiles.size) }
        val canRegister = if (inputMode == VoiceCaptureMode.Record) {
            audio != null && durationError == null
        } else if (speakerCount > 1) {
            selectedSpeakerIds.isNotEmpty() && selectedSpeakerIds.size <= remainingProfileSlots
        } else {
            selectedFileUri != null && durationError == null
        }
        AlertDialog(
            onDismissRequest = ::closeCreateDialog,
            title = { Text("음성 프로필 추가") },
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
                        label = { Text("프로필 이름") },
                        placeholder = { Text(voiceProfilePlaceholder(voiceProfiles.size)) },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    if (canShareVoice) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text("음성 공유", fontWeight = FontWeight.SemiBold)
                                MutedText("가족/커플 플랜에서만 공유돼요. 기본은 공유 안 함이에요.")
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
                        onSelect = { inputMode = it },
                    )

                    if (inputMode == VoiceCaptureMode.Record) {
                        VoiceRecordControls(
                            isRecording = isRecording,
                            elapsedMillis = recordingElapsedMillis,
                            maxDurationMillis = VoiceProfileAudioLimits.MAX_DURATION_MILLIS,
                            levels = recordingLevels,
                            enabled = !voiceProfileBusy,
                            notice = "30초 이상 1분 이하로 녹음해 주세요.",
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
                                uploadLabel = "파일 업로드",
                                notice = "30초 이상 1분 이하 구간을 선택해 주세요.",
                                onPickFile = { pickAudioLauncher.launch("audio/*") },
                                onCropChange = { start, end ->
                                    if (start != cropStartMillis || end != cropEndMillis) {
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
                                            enabled = !separatingBusy,
                                            modifier = Modifier.weight(1f),
                                        ) {
                                            Text(if (separatingBusy) "분리 중" else "화자 분리")
                                        }
                                        OutlinedButton(
                                            onClick = { resetSpeakers() },
                                            enabled = detectedSpeakers.isNotEmpty() || removedSpeakerIds.isNotEmpty(),
                                            modifier = Modifier.weight(1f),
                                        ) {
                                            Text("초기화")
                                        }
                                    }
                                    val visibleSpeakers = detectedSpeakers.filterNot { it.id in removedSpeakerIds }
                                    visibleSpeakers.forEachIndexed { index, speaker ->
                                        SpeakerCandidateRow(
                                            speaker = speaker,
                                            index = index,
                                            selected = speaker.id in selectedSpeakerIds,
                                            canSelectMore = selectedSpeakerIds.size < remainingProfileSlots,
                                            onToggle = {
                                                selectedSpeakerIds = if (speaker.id in selectedSpeakerIds) {
                                                    selectedSpeakerIds - speaker.id
                                                } else if (selectedSpeakerIds.size < remainingProfileSlots) {
                                                    selectedSpeakerIds + speaker.id
                                                } else {
                                                    selectedSpeakerIds
                                                }
                                            },
                                            onPreview = { playSpeakerPreview(speaker) },
                                            onRemove = {
                                                removedSpeakerIds = removedSpeakerIds + speaker.id
                                                selectedSpeakerIds = selectedSpeakerIds - speaker.id
                                            },
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
            title = { Text("이름 변경") },
            text = {
                OutlinedTextField(
                    value = renameName,
                    onValueChange = { renameName = it.take(50) },
                    label = { Text("프로필 이름") },
                    singleLine = true,
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
        AlertDialog(
            onDismissRequest = { deleteTarget = null },
            title = { Text("음성 프로필 삭제") },
            text = {
                Text("'${profile.name}' 프로필을 삭제할까요? 연결된 메시지가 있으면 삭제가 실패할 수 있어요.")
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        onDeleteVoiceProfile(profile.id)
                        deleteTarget = null
                    },
                ) {
                    Text("삭제")
                }
            },
            dismissButton = {
                TextButton(onClick = { deleteTarget = null }) {
                    Text("취소")
                }
            },
        )
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

@Composable
private fun SpeakerCandidateRow(
    speaker: VoiceSpeakerSegment,
    index: Int,
    selected: Boolean,
    canSelectMore: Boolean,
    onToggle: () -> Unit,
    onPreview: () -> Unit,
    onRemove: () -> Unit,
) {
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
                    text = "음성 프로필 ${index + 1}",
                    fontWeight = FontWeight.SemiBold,
                )
                MutedText(speakerDurationLabel(speaker))
            }
            IconButton(onClick = onPreview) {
                Icon(Icons.Outlined.PlayArrow, contentDescription = "미리듣기")
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
            IconButton(onClick = onRemove) {
                Icon(Icons.Outlined.Delete, contentDescription = "제거")
            }
        }
    }
}

@Composable
internal fun VoiceProfileRow(
    profile: VoiceProfile,
    enabled: Boolean,
    onRename: () -> Unit,
    onDelete: () -> Unit,
) {
    OutlinedCard {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.weight(1f),
                ) {
                    Text(profile.name, fontWeight = FontWeight.SemiBold)
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
        }
    }
}
