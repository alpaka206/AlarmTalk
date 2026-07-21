package com.alarmtalk.app

import androidx.compose.foundation.background
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
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
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
    val previewController = rememberVoiceOnboardingPreviewController(onDownloadStockAudio)

    var selectedId by remember(systemVoices) {
        mutableStateOf(systemVoices.firstOrNull()?.id)
    }
    val voiceLoadFinished = voiceProfileLoadFinished && !voiceProfileBusy

    // 로그인(랜딩~인증)과 같은 고정 새벽 네이비 비주얼 — 라이트 테마에서 이 스텝만 흰 화면으로
    // 튀지 않게 온보딩 시퀀스의 톤을 그대로 잇는다(문서화된 예외 팔레트).
    // 라이트 테마에서도 시스템 바 아이콘이 어두워지지 않게 씬 색으로 오버라이드(Codex #606).
    SceneSystemBars(top = OnbSceneTop, bottom = OnbSceneBottom)
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(
                Brush.verticalGradient(listOf(OnbSceneTop, OnbSceneBottom)),
            ),
    ) {
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
                    color = TextOnScene,
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    text = stringResource(R.string.onb_voice_subtitle),
                    style = MaterialTheme.typography.bodyMedium,
                    color = TextOnSceneDim,
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
                        CircularProgressIndicator(
                            modifier = Modifier.size(22.dp),
                            strokeWidth = 2.dp,
                            color = BrandAccentOnScene,
                        )
                        Spacer(Modifier.width(12.dp))
                        Text(
                            text = stringResource(R.string.onb_voice_loading),
                            style = MaterialTheme.typography.bodyMedium,
                            color = TextOnSceneDim,
                        )
                    }
                } else if (systemVoices.isEmpty()) {
                    Text(
                        text = stringResource(R.string.msg_voice_fetch_failed),
                        style = MaterialTheme.typography.bodyMedium,
                        color = TextOnSceneDim,
                        modifier = Modifier.padding(vertical = 40.dp),
                        textAlign = TextAlign.Center,
                    )
                } else {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        systemVoices.forEach { profile ->
                            VoiceChoiceRow(
                                name = profile.name,
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
                GradientCta(
                    text = stringResource(R.string.onb_voice_confirm),
                    onClick = {
                        val id = selectedId
                        if (id != null) {
                            previewController.stopPreview()
                            // 온보딩(무료 기본 목소리)은 고정 문구 클립만 재생하므로 호칭을 받지 않는다.
                            onChoose(id)
                        }
                    },
                    enabled = selectedId != null,
                )
                // 강제 1탭 선택이라 정상 흐름엔 "건너뛰기" 없음(항상 1개가 선택돼 있음).
                // 단, 목소리를 못 불러온 예외 상황에서만 사용자가 갇히지 않게 건너뛰기를 노출한다.
                if (systemVoices.isEmpty() && voiceLoadFinished) {
                    TextButton(onClick = { previewController.stopPreview(); onSkip() }) {
                        Text(
                            text = stringResource(R.string.onb_voice_skip),
                            color = AuthTextMuted,
                        )
                    }
                }
            }
        }
    }
}

// 새벽 네이비 온보딩 배경(AuthScreen 의 장면 색과 동일 값 — 그쪽은 private 이라 재선언).
private val OnbSceneTop = Color(0xFF1A2A52)
private val OnbSceneBottom = Color(0xFF070C1D)
private val OnbCardGlass = Color(0x14FFFFFF)

@Composable
private fun VoiceChoiceRow(
    name: String,
    selected: Boolean,
    preparing: Boolean,
    onSelect: () -> Unit,
) {
    Surface(
        onClick = onSelect,
        modifier = Modifier.fillMaxWidth(),
        // 낮은 선택 행(≈52dp)에 22 는 near-pill — 표준 패널(18)로 낮춘다.
        shape = WakerPanelShape,
        color = if (selected) BrandAccentOnScene.copy(alpha = 0.22f) else OnbCardGlass,
        border = androidx.compose.foundation.BorderStroke(
            1.dp,
            if (selected) BrandAccentOnScene.copy(alpha = 0.85f) else AuthLine,
        ),
    ) {
        Row(
            modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 14.dp, bottom = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = name,
                modifier = Modifier.weight(1f),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                color = TextOnScene,
            )
            Spacer(Modifier.width(8.dp))
            // 샘플 준비 중에만 자리 표시 — 평소엔 선택 점만 남겨 카드가 조용하다.
            if (preparing) {
                CircularProgressIndicator(
                    modifier = Modifier.size(18.dp),
                    strokeWidth = 2.dp,
                    color = BrandAccentOnScene,
                )
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
            color = if (selected) BrandAccentOnScene else Color.Transparent,
            border = if (selected) null else androidx.compose.foundation.BorderStroke(2.dp, AuthLine),
            modifier = Modifier.size(18.dp),
        ) {
            if (selected) {
                Box(contentAlignment = Alignment.Center, modifier = Modifier.fillMaxSize()) {
                    Surface(
                        shape = CircleShape,
                        color = OnbSceneBottom,
                        modifier = Modifier.size(7.dp),
                    ) {}
                }
            }
        }
    }
}
