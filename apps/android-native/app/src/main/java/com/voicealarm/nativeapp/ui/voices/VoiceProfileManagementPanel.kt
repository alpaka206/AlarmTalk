package com.voicealarm.nativeapp

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.util.Log
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.voicealarm.nativeapp.core.VoiceAlarmLog.TAG
import com.voicealarm.nativeapp.data.AlarmAudioLimits
import com.voicealarm.nativeapp.data.AlarmAudioStore
import com.voicealarm.nativeapp.data.AlarmVoiceRecorder
import com.voicealarm.nativeapp.data.CachedAlarmAudio
import com.voicealarm.nativeapp.network.VoiceProfile
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

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
    onRefresh: () -> Unit,
    onCreateVoiceProfile: (String, CachedAlarmAudio) -> Unit,
    onRenameVoiceProfile: (String, String) -> Unit,
    onDeleteVoiceProfile: (String) -> Unit,
) {
    val context = LocalContext.current
    val appContext = context.applicationContext
    val audioStore = remember(appContext) { AlarmAudioStore(appContext) }
    val recorder = remember(appContext) { AlarmVoiceRecorder(appContext, audioStore) }
    val scope = rememberCoroutineScope()
    var profileName by remember { mutableStateOf("") }
    var selectedAudio by remember { mutableStateOf<CachedAlarmAudio?>(null) }
    var localMessage by remember { mutableStateOf<String?>(null) }
    var isRecording by remember { mutableStateOf(false) }
    var showCreateConfirm by remember { mutableStateOf(false) }
    var renameTarget by remember { mutableStateOf<VoiceProfile?>(null) }
    var renameName by remember { mutableStateOf("") }
    var deleteTarget by remember { mutableStateOf<VoiceProfile?>(null) }
    val isLimitReached = voiceProfiles.size >= MAX_VOICE_PROFILES

    fun applySelectedAudio(audio: CachedAlarmAudio) {
        selectedAudio = audio
        val seconds = audio.durationMillis?.let { " (${it / 1000}초)" } ?: ""
        localMessage = "프로필 생성용 오디오를 준비했어요$seconds"
    }

    fun cacheSelectedAudio(uri: Uri) {
        scope.launch {
            runCatching {
                withContext(Dispatchers.IO) { audioStore.cacheFromUri(uri) }
            }.onSuccess(::applySelectedAudio)
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
                applySelectedAudio(audio)
            }.onFailure { error ->
                isRecording = false
                Log.e(TAG, "Failed to stop voice profile recording", error)
                localMessage = userFacingError(error, "녹음에 실패했어요")
            }
        }
    }

    fun startRecording() {
        runCatching {
            recorder.start()
            isRecording = true
            localMessage = "녹음 중..."
        }.onFailure { error ->
            Log.e(TAG, "Failed to start voice profile recording", error)
            localMessage = userFacingError(error, "녹음을 시작할 수 없어요")
        }
    }

    val pickAudioLauncher = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) cacheSelectedAudio(uri)
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
            delay(AlarmAudioLimits.MAX_DURATION_MILLIS)
            if (isRecording) stopRecording()
        }
    }

    DisposableEffect(Unit) {
        onDispose {
            if (recorder.isRecording) recorder.cancel()
        }
    }

    OutlinedCard {
        Column(
            modifier = Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            PanelHeader(
                title = "내 음성 프로필",
                actionLabel = if (voiceProfileBusy) "처리 중" else "새로고침",
                enabled = !voiceProfileBusy,
                onAction = onRefresh,
            )
            MutedText("등록 ${voiceProfiles.size}/${MAX_VOICE_PROFILES}개")

            if (isLimitReached) {
                MutedText("음성 프로필은 최대 ${MAX_VOICE_PROFILES}개까지 만들 수 있어요.")
            } else {
                OutlinedTextField(
                    value = profileName,
                    onValueChange = { profileName = it.take(50) },
                    label = { Text("프로필 이름") },
                    placeholder = { Text("예: 내 목소리") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Text(
                    text = selectedAudio?.let { "선택된 오디오: ${audioFileLabel(it.localAudioUri)}" }
                        ?: "30초 이하 녹음 또는 음성 파일을 선택해 주세요.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    OutlinedButton(
                        onClick = { pickAudioLauncher.launch("audio/*") },
                        enabled = !voiceProfileBusy && !isRecording,
                        modifier = Modifier.weight(1f),
                    ) {
                        Text("파일 선택")
                    }
                    Button(
                        onClick = {
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
                        enabled = !voiceProfileBusy,
                        modifier = Modifier.weight(1f),
                    ) {
                        Text(if (isRecording) "녹음 종료" else "녹음")
                    }
                }
                Button(
                    onClick = { showCreateConfirm = true },
                    enabled = profileName.isNotBlank() && selectedAudio != null && !voiceProfileBusy && !isRecording,
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(16.dp),
                ) {
                    Text("음성 프로필 만들기")
                }
                MutedText("프로필 만들기는 음성 복제 API를 호출하므로 실제 크레딧이 발생할 수 있어요.")
            }

            if (localMessage != null) {
                MutedText(localMessage.orEmpty())
            }

            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(1.dp)
                    .background(MaterialTheme.colorScheme.outlineVariant),
            )

            Text("프로필 목록", fontWeight = FontWeight.SemiBold)
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
    }

    if (showCreateConfirm) {
        val audio = selectedAudio
        AlertDialog(
            onDismissRequest = { showCreateConfirm = false },
            title = { Text("음성 프로필 만들기") },
            text = {
                Text("이 작업은 음성 복제 API를 호출해 크레딧이 발생할 수 있어요. 계속할까요?")
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        showCreateConfirm = false
                        if (audio != null) onCreateVoiceProfile(profileName, audio)
                    },
                ) {
                    Text("만들기")
                }
            },
            dismissButton = {
                TextButton(onClick = { showCreateConfirm = false }) {
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
                    AvatarBubble(label = profile.name)
                    Column {
                        Text(profile.name, fontWeight = FontWeight.SemiBold)
                        MutedText("${voiceStatusLabel(profile.status)} · ${profile.createdAt ?: "생성일 알 수 없음"}")
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                    TextButton(onClick = onRename, enabled = enabled) {
                        Text("이름")
                    }
                    TextButton(onClick = onDelete, enabled = enabled) {
                        Text("삭제")
                    }
                }
            }
        }
    }
}
