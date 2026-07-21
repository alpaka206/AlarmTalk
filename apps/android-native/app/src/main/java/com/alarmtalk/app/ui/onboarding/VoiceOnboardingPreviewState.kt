package com.alarmtalk.app

import android.content.Context
import android.media.MediaPlayer
import android.net.Uri
import android.util.Base64
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import com.alarmtalk.app.network.StockClip
import com.alarmtalk.app.network.TtsMessageAudioResponse
import com.alarmtalk.app.network.VoiceProfile
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

internal class VoiceOnboardingPreviewController(
    private val context: Context,
    private val scope: CoroutineScope,
    private val downloadStockAudio: suspend (String) -> TtsMessageAudioResponse,
) {
    var playingVoiceId by mutableStateOf<String?>(null)
        private set
    var preparingVoiceId by mutableStateOf<String?>(null)
        private set

    private var mediaPlayer: MediaPlayer? = null
    private var previewRequestId by mutableIntStateOf(0)

    fun stopPreview(invalidateRequest: Boolean = true) {
        if (invalidateRequest) previewRequestId += 1
        mediaPlayer?.release()
        mediaPlayer = null
        playingVoiceId = null
        preparingVoiceId = null
    }

    fun previewVoice(profile: VoiceProfile, stockClips: List<StockClip>) {
        if (playingVoiceId == profile.id) {
            stopPreview()
            return
        }
        // greeting 은 3개 언어가 있으므로 앱 언어로 골라야 한다(무필터 firstOrNull 이면 항상 en).
        val locales = context.resources.configuration.locales
        val appLanguage = com.alarmtalk.app.data.appVoiceLanguageOf(
            (if (!locales.isEmpty) locales[0] else null)?.language,
        )
        // 기본 목소리는 내장 인사말(res/raw)을 즉시 재생 — 스톡 매니페스트가 아직 안 왔거나
        // 네트워크가 없어도 '눌렀는데 아무 소리 없음'이 되지 않는다.
        val bundledRes = com.alarmtalk.app.data.bundledSystemGreetingRes(profile.id, appLanguage)
        if (bundledRes != null) {
            previewRequestId += 1
            stopPreview(invalidateRequest = false)
            val player = MediaPlayer.create(context, bundledRes) ?: return
            playingVoiceId = profile.id
            mediaPlayer = player.apply {
                setOnCompletionListener {
                    it.release()
                    if (mediaPlayer === it) mediaPlayer = null
                    if (playingVoiceId == profile.id) playingVoiceId = null
                }
                start()
            }
            return
        }
        val clip = com.alarmtalk.app.data.greetingStockClipFor(stockClips, profile.id, appLanguage)
            ?: return

        val requestId = previewRequestId + 1
        previewRequestId = requestId
        scope.launch {
            stopPreview(invalidateRequest = false)
            preparingVoiceId = profile.id
            runCatching {
                val response = downloadStockAudio(clip.messageId)
                val file = withContext(Dispatchers.IO) {
                    val bytes = Base64.decode(response.audioBase64, Base64.DEFAULT)
                    val ext = response.audioFormat.ifBlank { "mp3" }
                    File(context.cacheDir, "voice_onboarding_preview.$ext").apply { writeBytes(bytes) }
                }
                val player = MediaPlayer.create(context, Uri.fromFile(file))
                    ?: error("Failed to create greeting preview player.")
                if (previewRequestId != requestId) {
                    player.release()
                    return@runCatching
                }
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
                if (previewRequestId == requestId) {
                    preparingVoiceId = null
                    if (playingVoiceId == profile.id) playingVoiceId = null
                }
            }
        }
    }

    fun dispose() {
        mediaPlayer?.release()
        mediaPlayer = null
    }
}

@Composable
internal fun rememberVoiceOnboardingPreviewController(
    onDownloadStockAudio: suspend (String) -> TtsMessageAudioResponse,
): VoiceOnboardingPreviewController {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val currentDownloadStockAudio = rememberUpdatedState(onDownloadStockAudio)
    val controller = remember(context, scope) {
        VoiceOnboardingPreviewController(
            context = context,
            scope = scope,
            downloadStockAudio = { messageId -> currentDownloadStockAudio.value(messageId) },
        )
    }
    DisposableEffect(controller) {
        onDispose { controller.dispose() }
    }
    return controller
}
