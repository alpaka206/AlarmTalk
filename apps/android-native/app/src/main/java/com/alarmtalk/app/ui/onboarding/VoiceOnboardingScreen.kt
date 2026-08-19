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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.work.WorkInfo
import kotlinx.coroutines.delay
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
     * 화면상 '받는 중' 과 구분되지 않지만 실제로는 진행하지 못하는 상태인가(재시도 대기,
     * 네트워크가 없어 큐에만 올라간 상태, 빈손으로 끝난 상태). 이때는 탈출구를 즉시 연다.
     *
     * 다만 **갇히지 않는다는 보장을 이 값에 걸지 않는다** — 아래 유예 타이머를 볼 것.
     */
    stalled: Boolean = false,
    /**
     * 프리페치 워커가 **아직 살아 있는가**(ENQUEUED/RUNNING/BLOCKED). 탈출구 문구를 이걸로
     * 가른다 — 살아 있을 때만 '백그라운드에서 계속 받기' 다.
     *
     * `failed` 로만 가르면 부족했다: 워커가 **아무것도 못 받고 성공**해도(빈 성공) 종료
     * 상태라 더는 돌지 않는데 `failed` 는 false 라, 돌지 않는 다운로드를 돈다고 말하게
     * 된다(Codex #673 P2). 종료했으면 무슨 이유든 '나중에 받기' 다.
     */
    downloadContinuing: Boolean = false,
    onRetry: () -> Unit,
    onSkip: () -> Unit,
) {

    // 로그인(랜딩~인증)과 같은 고정 새벽 네이비 비주얼 — 라이트 테마에서 이 스텝만 흰 화면으로
    // 튀지 않게 온보딩 시퀀스의 톤을 그대로 잇는다(문서화된 예외 팔레트).
    // 라이트 테마에서도 시스템 바 아이콘이 어두워지지 않게 씬 색으로 오버라이드(Codex #606).
    // 탈출구(나중에 받기) 노출 규칙.
    //
    // **'어떤 상태에서 갇히는가' 를 열거해 맞히지 않는다.** 그렇게 짰다가 두 조합에서 갇혔다
    // (Codex #660): ① 네트워크가 없어 워커가 runAttemptCount=0 인 채 ENQUEUED 로만 남는 경우
    // — 재시도 대기가 아니라 stalled 가 false 다. ② 매니페스트가 아직 없어 워커가 아무것도
    // 받지 못하고 성공(SUCCEEDED)으로 끝난 경우 — 실패도 대기도 아닌데 게이트는 안 닫힌다.
    // 둘 다 진행 표시만 도는 화면에 뒤로가기까지 막힌 상태로 영원히 남는다.
    //
    // 그래서 보장은 시간으로 건다. 아는 상태(failed/stalled)면 즉시 열고, 모르는 조합이어도
    // 유예가 지나면 무조건 열린다. 원래 의도('몇 초면 끝날 일에 선택지를 내밀지 않는다')는
    // 유예 안에서 그대로 지켜진다.
    var graceElapsed by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        delay(ESCAPE_GRACE_MILLIS)
        graceElapsed = true
    }
    val showEscape = failed || stalled || graceElapsed

    // 뒤로가기: 탈출구가 보일 때는 그 동작(나중에 받기)에 잇고, 정상적으로 받는 중에는
    // 삼킨다. 그대로 두면 시스템 기본 동작이 앱을 닫아 버려, 몇 초 기다리면 될 일에
    // 사용자가 튕겨 나간다.
    BackHandler(enabled = true) { if (showEscape) onSkip() }

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
                // 그 '몇 초' 가 지나면 어떤 상태든 반드시 보여준다. 여기서 갇히면 앱을 아예 못 쓴다.
                //
                // 문구는 **상태에 따라 다르다.** 받는 중이면 '백그라운드에서 계속 받기' 다 —
                // 이 버튼은 워커를 취소하지 않으므로(skipVoiceSetup 은 화면만 닫는다) 실제로
                // 계속 받는다. 미루는 것처럼 말하면 사용자는 알람 음성이 없는 줄 알고 기다린다.
                //
                // 반대로 **워커가 끝났으면 아무것도 돌고 있지 않다.** 실패(FAILED)든 아무것도
                // 못 받은 성공(빈 성공)이든 종료 상태라 그대로 나가면 재시도가 없고,
                // onSkip 은 워커를 새로 넣지 않는다. 그때 '계속 받기' 라고 하면 돌지 않는
                // 다운로드를 돈다고 말하는 셈이다(Codex #673 P2). 그래서 실패 여부가 아니라
                // **워커가 살아 있는지**(downloadContinuing)로 가른다.
                if (showEscape) {
                    TextButton(onClick = onSkip) {
                        Text(
                            text = if (downloadContinuing) {
                                stringResource(R.string.onb_voice_download_background)
                            } else {
                                stringResource(R.string.onb_voice_download_later)
                            },
                            color = AuthTextMuted,
                        )
                    }
                }
            }
        }
    }
}

/**
 * 프리페치 워커가 **확실히** 진행하지 못하는 상태인가(= 유예를 기다리지 않고 바로 탈출구를
 * 여는 조건).
 *
 * 진입 직후의 `null`·`ENQUEUED(시도 이력 없음)` 는 여기 넣지 않는다 — 정상 경로와 구분이
 * 안 돼, 넣으면 모두에게 '나중에 받기' 가 깜빡인다. 네트워크가 없어 영영 큐에만 남는
 * 경우도 상태만으로는 같은 모양이라 가를 수 없고, 그건 화면의 유예 타이머가 받는다.
 */
internal fun stockPrefetchStalled(state: WorkInfo.State?, runAttemptCount: Int): Boolean =
    (state == WorkInfo.State.ENQUEUED && runAttemptCount > 0) ||
        // 끝났는데 이 화면이 아직 떠 있다 = 워커가 빈손으로 성공한 것이다(매니페스트 미도착
        // 등). completeVoiceSetupIfDownloaded 가 캐시 0 이라 게이트를 못 닫는다.
        state?.isFinished == true

/**
 * 탈출구가 늦어도 이때까지는 열린다. 프리페치는 보통 이보다 훨씬 빨리 끝나므로 정상 경로의
 * 사용자는 이 버튼을 볼 일이 없고, 막힌 사용자는 확실히 빠져나간다.
 */
private const val ESCAPE_GRACE_MILLIS = 12_000L

// 새벽 네이비 온보딩 배경(AuthScreen 의 장면 색과 동일 값 — 그쪽은 private 이라 재선언).
private val OnbSceneTop = Color(0xFF1A2A52)
private val OnbSceneBottom = Color(0xFF070C1D)
