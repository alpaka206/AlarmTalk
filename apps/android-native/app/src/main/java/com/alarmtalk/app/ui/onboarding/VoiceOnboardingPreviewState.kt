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

    /**
     * 인사말 미리듣기. 프로필 객체가 아니라 **id** 를 받는다 — 내 목소리(VoiceProfile)와
     * 공유받은 목소리(FamilyVoiceProfile)는 타입이 다르고 각각 다른 목록에 들어 있는데,
     * 여기서 필요한 건 id 뿐이라 id 로 받아야 둘 다 같은 경로를 탄다. 알람 편집기의 선택
     * 시트는 두 종류를 한 목록에 섞어 보여 준다(Codex #646).
     *
     * 모르는 id 면 인사말 클립을 못 찾아 조용히 아무것도 하지 않는다.
     */
    fun previewVoice(voiceProfileId: String, stockClips: List<StockClip>) {
        if (playingVoiceId == voiceProfileId) {
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
        val bundledRes = com.alarmtalk.app.data.bundledSystemGreetingRes(voiceProfileId, appLanguage)
        if (bundledRes != null) {
            previewRequestId += 1
            stopPreview(invalidateRequest = false)
            val player = MediaPlayer.create(context, bundledRes) ?: return
            playingVoiceId = voiceProfileId
            mediaPlayer = player.apply {
                setOnCompletionListener {
                    it.release()
                    if (mediaPlayer === it) mediaPlayer = null
                    if (playingVoiceId == voiceProfileId) playingVoiceId = null
                }
                start()
            }
            return
        }
        val clip = com.alarmtalk.app.data.greetingStockClipFor(stockClips, voiceProfileId, appLanguage)
            ?: return

        val requestId = previewRequestId + 1
        previewRequestId = requestId
        scope.launch {
            stopPreview(invalidateRequest = false)
            preparingVoiceId = voiceProfileId
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
                playingVoiceId = voiceProfileId
                mediaPlayer = player.apply {
                    setOnCompletionListener {
                        it.release()
                        if (mediaPlayer === it) mediaPlayer = null
                        if (playingVoiceId == voiceProfileId) playingVoiceId = null
                    }
                    start()
                }
            }.onFailure {
                if (previewRequestId == requestId) {
                    preparingVoiceId = null
                    if (playingVoiceId == voiceProfileId) playingVoiceId = null
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
