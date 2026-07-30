package com.alarmtalk.app

import androidx.activity.compose.BackHandler
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
    /**
     * 워커가 실패 후 재시도를 기다리는 중인가. 화면상 '받는 중' 과 구분되지 않지만 실제로는
     * 막혀 있는 상태라, 여기서도 빠져나갈 길을 열어 준다 — 아니면 사용자는 영문도 모르고
     * 진행 표시만 보며 갇힌다.
     */
    stalled: Boolean = false,
    onRetry: () -> Unit,
    onSkip: () -> Unit,
) {

    // 로그인(랜딩~인증)과 같은 고정 새벽 네이비 비주얼 — 라이트 테마에서 이 스텝만 흰 화면으로
    // 튀지 않게 온보딩 시퀀스의 톤을 그대로 잇는다(문서화된 예외 팔레트).
    // 라이트 테마에서도 시스템 바 아이콘이 어두워지지 않게 씬 색으로 오버라이드(Codex #606).
    // 뒤로가기: 탈출구가 보일 때는 그 동작(나중에 받기)에 잇고, 정상적으로 받는 중에는
    // 삼킨다. 그대로 두면 시스템 기본 동작이 앱을 닫아 버려, 몇 초 기다리면 될 일에
    // 사용자가 튕겨 나간다.
    BackHandler(enabled = true) { if (failed || stalled) onSkip() }

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
                    text = stringResource(
                        if (failed) R.string.onb_voice_title_failed else R.string.onb_voice_title,
                    ),
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold,
                    color = TextOnScene,
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
                        // 44 분의 몇 인지는 사용자에게 의미 없는 숫자다(무료 버킷 문구 수 ×
                        // 언어 수). 얼마나 남았는지만 알면 되므로 퍼센트로 환산해 보여준다.
                        text = if (total > 0) {
                            stringResource(R.string.onb_voice_download_progress, done * 100 / total)
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
                // 정상적으로 받는 중에는 숨긴다 — 몇 초면 끝나는 일에 선택지를 내밀 필요가 없다.
                // 대신 실패했거나 재시도 대기로 멈춰 있으면 반드시 보여준다. 여기서 갇히면
                // 앱을 아예 못 쓴다.
                if (failed || stalled) {
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
}

// 새벽 네이비 온보딩 배경(AuthScreen 의 장면 색과 동일 값 — 그쪽은 private 이라 재선언).
private val OnbSceneTop = Color(0xFF1A2A52)
private val OnbSceneBottom = Color(0xFF070C1D)
private val OnbCardGlass = Color(0x14FFFFFF)
