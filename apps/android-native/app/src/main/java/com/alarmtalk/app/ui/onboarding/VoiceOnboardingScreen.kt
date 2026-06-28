package com.alarmtalk.app

import android.media.MediaPlayer
import android.net.Uri
import android.util.Base64
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.Stop
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.alarmtalk.app.data.STOCK_GREETING_CATEGORY
import com.alarmtalk.app.network.StockClip
import com.alarmtalk.app.network.TtsMessageAudioResponse
import com.alarmtalk.app.network.VoiceProfile
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * 온보딩 "목소리 고르기" 스텝. 무료 사용자에게 4개 기본 목소리를 한꺼번에 펼쳐 보여주는
 * 대신, 미리듣기하며 **1개를 기본 목소리로 선택**하게 한다(나중에 변경 가능).
 *
 * - systemVoices: 시스템(스톡) 보이스 목록. 아직 로드 전이면 로딩/건너뛰기.
 * - 각 목소리의 인사말 샘플(greeting 스톡 클립)을 다운로드해 미리 들려준다.
 * - 선택 후 [onChoose] 로 기본 목소리 id 를 저장한다.
 */
@Composable
internal fun VoiceOnboardingScreen(
    contentPadding: PaddingValues,
    systemVoices: List<VoiceProfile>,
    stockClips: List<StockClip>,
    onDownloadStockAudio: suspend (String) -> TtsMessageAudioResponse,
    onChoose: (String, String?) -> Unit,
    onSkip: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var selectedId by remember(systemVoices) {
        mutableStateOf(systemVoices.firstOrNull()?.id)
    }
    // 이 기본 목소리가 사용자를 부를 호칭(선택 입력). 비우면 이름 없이.
    var listenerTitle by remember { mutableStateOf("") }
    var mediaPlayer by remember { mutableStateOf<MediaPlayer?>(null) }
    var playingVoiceId by remember { mutableStateOf<String?>(null) }
    var preparingVoiceId by remember { mutableStateOf<String?>(null) }

    fun stopPreview() {
        mediaPlayer?.release()
        mediaPlayer = null
        playingVoiceId = null
        preparingVoiceId = null
    }

    DisposableEffect(Unit) {
        onDispose { mediaPlayer?.release() }
    }

    fun previewVoice(profile: VoiceProfile) {
        if (playingVoiceId == profile.id) {
            stopPreview()
            return
        }
        val clip = stockClips.firstOrNull {
            it.voiceProfileId == profile.id && it.category == STOCK_GREETING_CATEGORY
        } ?: stockClips.firstOrNull { it.voiceProfileId == profile.id } ?: return
        scope.launch {
            stopPreview()
            preparingVoiceId = profile.id
            runCatching {
                val response = onDownloadStockAudio(clip.messageId)
                val file = withContext(Dispatchers.IO) {
                    val bytes = Base64.decode(response.audioBase64, Base64.DEFAULT)
                    val ext = response.audioFormat.ifBlank { "mp3" }
                    File(context.cacheDir, "voice_onboarding_preview.$ext").apply { writeBytes(bytes) }
                }
                val player = MediaPlayer.create(context, Uri.fromFile(file)) ?: return@runCatching
                preparingVoiceId = null
                playingVoiceId = profile.id
                mediaPlayer = player.apply {
                    setOnCompletionListener {
                        it.release()
                        if (mediaPlayer === it) mediaPlayer = null
                        if (playingVoiceId == profile.id) playingVoiceId = null
                    }
                    start()
                }
            }.onFailure {
                preparingVoiceId = null
                if (playingVoiceId == profile.id) playingVoiceId = null
            }
        }
    }

    fun sampleText(profile: VoiceProfile): String? =
        (stockClips.firstOrNull { it.voiceProfileId == profile.id && it.category == STOCK_GREETING_CATEGORY }
            ?: stockClips.firstOrNull { it.voiceProfileId == profile.id })?.text

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(contentPadding),
    ) {
        Column(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp),
        ) {
            Spacer(Modifier.height(16.dp))
            Text(
                text = stringResource(R.string.onb_voice_title),
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold,
            )
            Spacer(Modifier.height(8.dp))
            Text(
                text = stringResource(R.string.onb_voice_subtitle),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(20.dp))

            if (systemVoices.isEmpty()) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 40.dp),
                    horizontalArrangement = Arrangement.Center,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    CircularProgressIndicator(modifier = Modifier.size(22.dp), strokeWidth = 2.dp)
                    Spacer(Modifier.width(12.dp))
                    Text(
                        text = stringResource(R.string.onb_voice_loading),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    systemVoices.forEach { profile ->
                        VoiceChoiceRow(
                            name = profile.name,
                            sample = sampleText(profile),
                            selected = profile.id == selectedId,
                            previewing = playingVoiceId == profile.id,
                            preparing = preparingVoiceId == profile.id,
                            onSelect = { selectedId = profile.id },
                            onPreview = { previewVoice(profile) },
                        )
                    }
                }
                Spacer(Modifier.height(24.dp))
                Text(
                    text = stringResource(R.string.onb_voice_nickname_label),
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = listenerTitle,
                    onValueChange = { listenerTitle = it },
                    placeholder = { Text(stringResource(R.string.onb_voice_nickname_placeholder)) },
                    singleLine = true,
                    shape = WakerInputShape,
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(6.dp))
                Text(
                    text = stringResource(R.string.onb_voice_nickname_hint),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Spacer(Modifier.height(16.dp))
        }

        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 24.dp, vertical = 12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Button(
                onClick = {
                    val id = selectedId ?: return@Button
                    stopPreview()
                    onChoose(id, listenerTitle.trim().takeIf { it.isNotEmpty() })
                },
                enabled = selectedId != null,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp),
                shape = WakerButtonShape,
            ) {
                Text(stringResource(R.string.onb_voice_confirm))
            }
            // 강제 1탭 선택이라 정상 흐름엔 "건너뛰기" 없음(항상 1개가 선택돼 있음).
            // 단, 목소리를 못 불러온 예외 상황에서만 사용자가 갇히지 않게 건너뛰기를 노출한다.
            if (systemVoices.isEmpty()) {
                TextButton(onClick = { stopPreview(); onSkip() }) {
                    Text(
                        text = stringResource(R.string.onb_voice_skip),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

@Composable
private fun VoiceChoiceRow(
    name: String,
    sample: String?,
    selected: Boolean,
    previewing: Boolean,
    preparing: Boolean,
    onSelect: () -> Unit,
    onPreview: () -> Unit,
) {
    Surface(
        onClick = onSelect,
        modifier = Modifier.fillMaxWidth(),
        shape = WakerCardShape,
        color = if (selected) {
            MaterialTheme.colorScheme.secondaryContainer
        } else {
            MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f)
        },
        border = if (selected) null else androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Row(
            modifier = Modifier.padding(start = 16.dp, end = 8.dp, top = 14.dp, bottom = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(3.dp),
            ) {
                Text(
                    text = name,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = if (selected) {
                        MaterialTheme.colorScheme.onSecondaryContainer
                    } else {
                        MaterialTheme.colorScheme.onSurface
                    },
                )
                if (!sample.isNullOrBlank()) {
                    Text(
                        text = sample,
                        style = MaterialTheme.typography.bodySmall,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                        color = if (selected) {
                            MaterialTheme.colorScheme.onSecondaryContainer.copy(alpha = 0.78f)
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        },
                    )
                }
            }
            Spacer(Modifier.width(8.dp))
            Surface(
                onClick = onPreview,
                shape = CircleShape,
                color = MaterialTheme.colorScheme.primary.copy(alpha = 0.12f),
                modifier = Modifier.size(40.dp),
            ) {
                Box(contentAlignment = Alignment.Center) {
                    if (preparing) {
                        CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                    } else {
                        Icon(
                            imageVector = if (previewing) Icons.Outlined.Stop else Icons.Outlined.PlayArrow,
                            contentDescription = if (previewing) {
                                stringResource(R.string.editor_stop)
                            } else {
                                stringResource(R.string.onb_voice_preview)
                            },
                            tint = MaterialTheme.colorScheme.primary,
                        )
                    }
                }
            }
            Spacer(Modifier.width(8.dp))
            VoiceChoiceDot(selected = selected)
        }
    }
}

@Composable
private fun VoiceChoiceDot(selected: Boolean) {
    Box(
        modifier = Modifier
            .size(22.dp)
            .padding(2.dp),
        contentAlignment = Alignment.Center,
    ) {
        Surface(
            shape = CircleShape,
            color = if (selected) MaterialTheme.colorScheme.primary else Color.Transparent,
            border = if (selected) null else androidx.compose.foundation.BorderStroke(2.dp, MaterialTheme.colorScheme.outline),
            modifier = Modifier.size(18.dp),
        ) {
            if (selected) {
                Box(contentAlignment = Alignment.Center, modifier = Modifier.fillMaxSize()) {
                    Surface(
                        shape = CircleShape,
                        color = MaterialTheme.colorScheme.onPrimary,
                        modifier = Modifier.size(7.dp),
                    ) {}
                }
            }
        }
    }
}
