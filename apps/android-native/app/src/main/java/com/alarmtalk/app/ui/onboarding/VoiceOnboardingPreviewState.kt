package com.alarmtalk.app

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioManager
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

    /**
     * 지금 재생 중인 것이 **알람 크기 미리듣기**인가. 목소리를 고르는 자리의 미리듣기는
     * 크기를 건드리지 않으므로, 슬라이더가 움직여도 그쪽 게인까지 바꾸면 안 된다.
     */
    private var alarmVolumePreview = false
    private var previewRequestId by mutableIntStateOf(0)

    /**
     * 재생 중인 알람 크기 미리듣기의 **게인만** 바꾼다(다시 틀지 않는다).
     * 슬라이더를 끄는 동안 소리가 그 자리에서 커지고 작아진다.
     */
    fun updateAlarmVolume(volumePercent: Int) {
        if (!alarmVolumePreview) return
        val gain = com.alarmtalk.app.alarm.VoiceVolumeRamp.targetVolume(volumePercent)
        runCatching { mediaPlayer?.setVolume(gain, gain) }
    }

    /**
     * 슬라이더에서 손을 뗐을 때 — **토글이 아니다.**
     *
     * 이미 그 목소리를 그 모드로 듣고 있으면 크기만 맞추고 끝낸다(말 중간에 다시 트는 것이
     * 더 거슬린다). 안 듣고 있으면(대개 2~3초짜리 샘플이 이미 끝났다) 그때 튼다.
     * 행의 재생 버튼은 예전대로 [previewVoice] 의 토글을 쓴다 — 누르면 멈춰야 하니까.
     */
    fun ensureAlarmVolumePreview(
        voiceProfileId: String,
        stockClips: List<StockClip>,
        volumePercent: Int,
    ) {
        if (alarmVolumePreview && playingVoiceId == voiceProfileId) {
            updateAlarmVolume(volumePercent)
            return
        }
        previewVoice(voiceProfileId, stockClips, alarmVolumePercent = volumePercent)
    }

    fun stopPreview(invalidateRequest: Boolean = true) {
        if (invalidateRequest) previewRequestId += 1
        alarmVolumePreview = false
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
    fun previewVoice(
        voiceProfileId: String,
        stockClips: List<StockClip>,
        /**
         * 목소리 크기 화면에서 부를 때의 **알람 음량**(0~100). 주면 울릴 때와 같은
         * 스트림(USAGE_ALARM)으로, 그 크기 그대로 들려준다.
         *
         * ⚠ **`null` 로 두는 자리(목소리 고르기·온보딩)와 뜻이 다르다.** 거기서는
         * "이 사람 목소리가 어떤가" 를 듣는 것이라 미디어 볼륨이 맞고, 여기서는
         * "이 설정이 얼마나 큰가" 를 재는 것이라 알람 볼륨이 아니면 잴 수가 없다
         * (CLAUDE.md 「미리듣기는 울림과 같은 스트림이어야 한다」).
         */
        alarmVolumePercent: Int? = null,
    ) {
        alarmVolumePreview = alarmVolumePercent != null
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
            val player = createPlayer(resId = bundledRes, uri = null, alarmVolumePercent = alarmVolumePercent)
                ?: return
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
                val player = createPlayer(
                    resId = null,
                    uri = Uri.fromFile(file),
                    alarmVolumePercent = alarmVolumePercent,
                ) ?: error("Failed to create greeting preview player.")
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

    /**
     * 미리듣기 플레이어를 만든다. [alarmVolumePercent] 가 있으면 알람 스트림·그 게인으로,
     * 없으면 예전처럼 기본(미디어) 스트림으로 만든다.
     */
    private fun createPlayer(resId: Int?, uri: Uri?, alarmVolumePercent: Int?): MediaPlayer? {
        val attributes = alarmVolumePercent?.let {
            AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build()
        }
        val player = when {
            resId != null && attributes != null ->
                MediaPlayer.create(context, resId, attributes, AudioManager.AUDIO_SESSION_ID_GENERATE)
            resId != null -> MediaPlayer.create(context, resId)
            uri != null && attributes != null ->
                MediaPlayer.create(context, uri, null, attributes, AudioManager.AUDIO_SESSION_ID_GENERATE)
            uri != null -> MediaPlayer.create(context, uri)
            else -> null
        } ?: return null
        alarmVolumePercent?.let {
            // 울릴 때와 같은 매핑을 쓴다 — 여기만 다른 식으로 계산하면 미리듣기와 알람이 어긋난다.
            val gain = com.alarmtalk.app.alarm.VoiceVolumeRamp.targetVolume(it)
            player.setVolume(gain, gain)
        }
        return player
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
