package com.alarmtalk.app.ui.voices

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.Button
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.alarmtalk.app.data.ClipReadiness

/**
 * **목소리 준비 화면** — 생성과 다운로드를 한 퍼센트로 보여 준다.
 *
 * iOS `ClipPreparationView.swift` 와 같은 화면이고 같은 문구를 쓴다.
 *
 * ⚠ **이 화면이 알람 만들기를 막지 않는다.** 여기서 나가도 알람은 만들 수 있어야 한다 —
 * 새벽에 전파가 나빠 내일 알람을 못 맞추는 일이 있어서는 안 된다. 못 받은 목소리만
 * 고를 수 없을 뿐이다.
 */
@Composable
fun ClipPreparationScreen(
    voices: List<ClipReadiness.VoiceProgress>,
    onRetry: () -> Unit,
    onDismiss: (() -> Unit)? = null,
    modifier: Modifier = Modifier,
) {
    val percent = ClipReadiness.percent(voices)
    val ready = ClipReadiness.isReady(voices)
    val hasFailure = voices.any { it.renderFailed }
    val rendering = voices.any { it.isRendering }

    Column(
        modifier = modifier.fillMaxSize().padding(horizontal = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(
            text = if (ready) "준비됐어요" else "$percent%",
            style = MaterialTheme.typography.displaySmall,
            color = MaterialTheme.colorScheme.onSurface,
        )
        Spacer(Modifier.padding(top = 16.dp))
        LinearProgressIndicator(
            progress = { percent / 100f },
            modifier = Modifier.fillMaxWidth().widthIn(max = 280.dp),
        )
        Spacer(Modifier.padding(top = 16.dp))
        Text(
            // ⚠ **무엇을 기다리는지 말한다.** 퍼센트만 있으면 멈춘 것처럼 보인다 —
            // 특히 서버 렌더 구간은 다운로드와 달리 몇 분이 걸릴 수 있다.
            text = when {
                ready -> "이제 오프라인에서도 목소리로 울려요."
                hasFailure -> "목소리를 만들다 실패했어요. 다시 시도해 주세요."
                rendering -> "목소리를 만들고 있어요. 몇 분 걸릴 수 있어요."
                else -> "목소리를 받고 있어요. 앱을 닫아도 계속 받아요."
            },
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )

        if (hasFailure) {
            Spacer(Modifier.padding(top = 24.dp))
            // 서버가 만들다 실패한 목소리만 다시 큐에 올린다. 다운로드 실패는 선다운로드가
            // 다음 회차에 부족분만 다시 받으므로 버튼이 필요 없다.
            Button(onClick = onRetry) { Text("다시 시도하기") }
        }

        if (onDismiss != null) {
            Spacer(Modifier.padding(top = 12.dp))
            TextButton(onClick = onDismiss) {
                Text(if (ready) "완료" else "백그라운드에서 계속 받기")
            }
        }
    }
}
