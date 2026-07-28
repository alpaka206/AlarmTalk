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
 * 기본 목소리 준비(다운로드) 화면.
 *
 * 예전에는 여기서 기본 목소리 하나를 고르게 했다. 이제 4개를 모두 받아 두고 알람마다
 * 고르므로 고르는 단계를 없앴다 — 아직 들어보지도 못한 목소리를 먼저 정하게 하는 것보다,
 * 다 받아 두고 알람 만들 때 들어보며 고르는 편이 낫다.
 *
 * 다운로드는 WorkManager 가 하므로 앱을 나가도 계속된다. 그래도 여기서 기다리길 권하는 건
 * 첫 알람을 만들 때 대기가 없게 하기 위해서다.
 */
@Composable
internal fun VoiceOnboardingScreen(
    contentPadding: PaddingValues,
    done: Int,
    total: Int,
    failed: Boolean,
    onRetry: () -> Unit,
    onSkip: () -> Unit,
) {

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
                    .padding(horizontal = 24.dp),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(
                    text = stringResource(R.string.onb_voice_title),
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold,
                    color = TextOnScene,
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(10.dp))
                Text(
                    text = stringResource(R.string.onb_voice_subtitle),
                    style = MaterialTheme.typography.bodyMedium,
                    color = TextOnSceneDim,
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(28.dp))

                if (failed) {
                    Text(
                        text = stringResource(R.string.onb_voice_download_failed),
                        style = MaterialTheme.typography.bodyMedium,
                        color = TextOnSceneDim,
                        textAlign = TextAlign.Center,
                    )
                } else {
                    CircularProgressIndicator(
                        modifier = Modifier.size(34.dp),
                        strokeWidth = 3.dp,
                        color = BrandAccentOnScene,
                    )
                    Spacer(Modifier.height(16.dp))
                    Text(
                        text = if (total > 0) {
                            stringResource(R.string.onb_voice_download_progress, done, total)
                        } else {
                            stringResource(R.string.onb_voice_loading)
                        },
                        style = MaterialTheme.typography.bodyMedium,
                        color = TextOnScene,
                    )
                    Spacer(Modifier.height(8.dp))
                    Text(
                        // 워커가 받으므로 나가도 이어지지만, 여기서 기다리는 편이 가장 빠르다.
                        text = stringResource(R.string.onb_voice_download_stay),
                        style = MaterialTheme.typography.bodySmall,
                        color = TextOnSceneDim,
                        textAlign = TextAlign.Center,
                    )
                }
            }

            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 24.dp, vertical = 12.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                if (failed) {
                    GradientCta(
                        text = stringResource(R.string.onb_voice_download_retry),
                        onClick = onRetry,
                        enabled = true,
                    )
                }
                // 나중에 받아도 되게 열어 둔다 — 여기서 갇히면 앱을 아예 못 쓴다.
                TextButton(onClick = onSkip) {
                    Text(
                        text = stringResource(R.string.onb_voice_download_later),
                        color = AuthTextMuted,
                    )
                }
            }
        }
    }
}

// 새벽 네이비 온보딩 배경(AuthScreen 의 장면 색과 동일 값 — 그쪽은 private 이라 재선언).
private val OnbSceneTop = Color(0xFF1A2A52)
private val OnbSceneBottom = Color(0xFF070C1D)
private val OnbCardGlass = Color(0x14FFFFFF)
