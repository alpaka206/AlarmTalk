package com.alarmtalk.app

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
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
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
    voiceProfileBusy: Boolean,
    voiceProfileLoadFinished: Boolean,
    stockClips: List<StockClip>,
    onDownloadStockAudio: suspend (String) -> TtsMessageAudioResponse,
    onChoose: (String) -> Unit,
    onSkip: () -> Unit,
) {
    val context = LocalContext.current
    val previewController = rememberVoiceOnboardingPreviewController(onDownloadStockAudio)

    var selectedId by remember(systemVoices) {
        mutableStateOf(systemVoices.firstOrNull()?.id)
    }
    val voiceLoadFinished = voiceProfileLoadFinished && !voiceProfileBusy
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

            if (systemVoices.isEmpty() && !voiceLoadFinished) {
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
            } else if (systemVoices.isEmpty()) {
                Text(
                    text = stringResource(R.string.msg_voice_fetch_failed),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(vertical = 40.dp),
                    textAlign = TextAlign.Center,
                )
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    systemVoices.forEach { profile ->
                        VoiceChoiceRow(
                            name = profile.name,
                            sample = sampleText(profile),
                            selected = profile.id == selectedId,
                            preparing = previewController.preparingVoiceId == profile.id,
                            // 별도 재생 버튼 없이, 카드를 누르면 선택과 동시에 샘플이 재생된다.
                            onSelect = {
                                selectedId = profile.id
                                previewController.previewVoice(profile, stockClips)
                            },
                        )
                    }
                }
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
                    previewController.stopPreview()
                    // 온보딩(무료 기본 목소리)은 고정 문구 클립만 재생하므로 호칭을 받지 않는다.
                    onChoose(id)
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
            if (systemVoices.isEmpty() && voiceLoadFinished) {
                TextButton(onClick = { previewController.stopPreview(); onSkip() }) {
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
    preparing: Boolean,
    onSelect: () -> Unit,
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
            modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 14.dp, bottom = 14.dp),
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
            // 샘플 준비 중에만 자리 표시 — 평소엔 선택 점만 남겨 카드가 조용하다.
            if (preparing) {
                CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                Spacer(Modifier.width(8.dp))
            }
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
