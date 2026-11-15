package com.alarmtalk.app.data

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaRecorder
import android.os.Build
import android.os.SystemClock
import android.util.Log
import androidx.core.net.toUri
import com.alarmtalk.app.R
import com.alarmtalk.app.core.AlarmTalkLog
import com.alarmtalk.app.core.AlarmTalkLog.TAG
import com.alarmtalk.app.UserFacingException
import java.io.File

/**
 * 녹음이 사용자의 동작이나 기기 사정(권한·다른 앱·전화)으로 끝났다는 표시(원인 사슬에 둔다). 결함이 아니라
 * [AlarmTalkLog] 가 이슈 대신 브레드크럼(`user`)으로 낮춘다. 화면은 [UserFacingException] 의 문구로 이유를 말한다.
 */
open class RecordingEndedByUserOrDeviceException(message: String, cause: Throwable?) :
    IllegalStateException(message, cause)

/**
 * 녹음을 시작하자마자 멈춰 녹음기가 아무것도 쓰지 못했다는 표시 — Sentry ALARMTALK-ANDROID-1P.
 *
 * 기기에서 0.15초 만에 멈추면 `MediaRecorder.stop()` 이 `RuntimeException: stop failed.` 를 던진다(A32 계측 테스트
 * `AlarmVoiceRecorderInstrumentedTest`). 그 메시지는 플랫폼의 것이라 다른 실패와 구별되지 않으므로, 판정은 **시작에서
 * 멈춤까지의 시간**으로 한다.
 */
class RecordingStoppedTooSoonException(elapsedMillis: Long, cause: Throwable) :
    RecordingEndedByUserOrDeviceException("Recording stopped ${elapsedMillis}ms after start.", cause)

/** 녹음 중(또는 시작할 때) 마이크 권한이 없었다. */
class RecordingPermissionMissingException(cause: Throwable?) :
    RecordingEndedByUserOrDeviceException("Microphone permission is missing.", cause)

/** 다른 앱·전화가 오디오를 가져가 녹음이 끊겼다. */
class RecordingInterruptedException(interruption: RecordingInterruption, cause: Throwable?) :
    RecordingEndedByUserOrDeviceException("Recording interrupted by ${interruption.diagnosticValue}.", cause)

/** 녹음이 끝나기 전에 끼어든 것. 녹음기는 표시만 하고, 화면의 녹음 루프가 보고 멈춘다(`stop()`). */
enum class RecordingInterruption(val diagnosticValue: String) {
    /** 오디오 포커스를 잃었다 — 전화·다른 앱의 재생·녹음. */
    AUDIO_FOCUS_LOSS("audio_focus_loss"),

    /** 녹음기 자체가 오류를 알렸다(미디어 서버 재시작 등). */
    RECORDER_ERROR("recorder_error"),
}

/** `MediaRecorder.stop()` 이 던졌을 때의 갈래 — 순수 함수 [classifyRecordingStopFailure] 가 가른다. */
enum class RecordingStopFailureKind {
    PERMISSION_MISSING,
    INTERRUPTED,
    STOPPED_TOO_SOON,
    UNKNOWN,
}

/** 이보다 빨리 멈춘 실패는 '시작하자마자 멈춤' 으로 읽는다. 녹음기가 첫 프레임을 쓰기 전 구간이다. */
internal const val RECORDING_STOPPED_TOO_SOON_MILLIS = 1_000L

/**
 * 멈춤 실패를 가른다. 권한이 먼저다(권한이 없으면 다른 이유는 따질 것이 없다), 그다음 끼어듦, 그다음 시간.
 * 셋 다 아니면 [RecordingStopFailureKind.UNKNOWN] — 이것만 이슈로 올라간다.
 */
internal fun classifyRecordingStopFailure(
    elapsedMillis: Long,
    micPermissionGranted: Boolean,
    interruption: RecordingInterruption?,
): RecordingStopFailureKind = when {
    !micPermissionGranted -> RecordingStopFailureKind.PERMISSION_MISSING
    interruption != null -> RecordingStopFailureKind.INTERRUPTED
    elapsedMillis < RECORDING_STOPPED_TOO_SOON_MILLIS -> RecordingStopFailureKind.STOPPED_TOO_SOON
    else -> RecordingStopFailureKind.UNKNOWN
}

/**
 * 멈춘 녹음.
 *
 * - [interruption]: 끼어들어 멈췄다 — 그때까지의 녹음은 **남긴다**(녹음 복구). 화면이 그 사실을 말하고 판정으로 보낸다.
 * - [recoveredAfterStopFailure]: `stop()` 이 던졌는데 파일은 읽혔다. 정상 완료본으로 다루지 않는다 — 화면이 들어 보고
 *   쓸지 다시 녹음할지를 묻는다(품질 판정의 권장 안내와 같은 자리).
 */
data class RecordingResult(
    val audio: CachedAlarmAudio,
    val interruption: RecordingInterruption?,
    val recoveredAfterStopFailure: Boolean,
)

class AlarmVoiceRecorder(
    private val context: Context,
    private val audioStore: AlarmAudioStore,
) {
    private var recorder: MediaRecorder? = null
    private var outputFile: File? = null
    private var startedAtElapsedMillis = 0L
    private var focusRequest: AudioFocusRequest? = null

    /** 녹음 중 끼어든 것. 포커스 콜백·오류 리스너가 다른 스레드에서 쓴다. */
    @Volatile
    var interruption: RecordingInterruption? = null
        private set

    val isRecording: Boolean
        get() = recorder != null

    fun start(maxDurationMillis: Long = AlarmAudioLimits.MAX_DURATION_MILLIS) {
        check(recorder == null) { "Recording is already in progress." }

        val file = audioStore.createRecordingFile()
        val mediaRecorder = newRecorder()
        try {
            mediaRecorder.apply {
                setAudioSource(MediaRecorder.AudioSource.MIC)
                setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
                setAudioEncodingBitRate(128_000)
                setAudioSamplingRate(44_100)
                setMaxDuration(maxDurationMillis.toInt())
                setOutputFile(file.absolutePath)
                setOnErrorListener { _, _, _ -> interruption = interruption ?: RecordingInterruption.RECORDER_ERROR }
                prepare()
                start()
            }
        } catch (error: Exception) {
            // 시작하지 못한 녹음기는 바로 놓는다 — 예전에는 놓지 않아 마이크를 쥔 채 남았다.
            runCatching { mediaRecorder.release() }
            file.delete()
            throw if (!micPermissionGranted()) {
                UserFacingException(
                    context.getString(R.string.recording_permission_missing),
                    RecordingPermissionMissingException(error),
                )
            } else {
                UserFacingException(context.getString(R.string.recording_mic_unavailable), error)
            }
        }

        interruption = null
        outputFile = file
        recorder = mediaRecorder
        startedAtElapsedMillis = SystemClock.elapsedRealtime()
        requestAudioFocus()
        Log.i(TAG, "Voice recording started path=${file.absolutePath}")
    }

    fun stop(): RecordingResult {
        val mediaRecorder = requireNotNull(recorder) { "Recording is not active." }
        val file = requireNotNull(outputFile) { "Recording output is missing." }

        val elapsedMillis = SystemClock.elapsedRealtime() - startedAtElapsedMillis
        val endedBy = interruption
        val stopped = runCatching { mediaRecorder.stop() }
        release()
        stopped.exceptionOrNull()?.let { error ->
            val kind = classifyRecordingStopFailure(elapsedMillis, micPermissionGranted(), endedBy)
            // 녹음 복구 — 시작하자마자 멈춘 것이 아니면 파일이 읽히는지 본다. 읽히면 남기되 정상 완료본으로 다루지
            // 않는다(화면이 들어 보고 정하게 한다). 못 읽으면 지운다 — 실패한 파일을 업로드하지 않는다.
            if (kind != RecordingStopFailureKind.STOPPED_TOO_SOON && isReadable(file)) {
                if (kind == RecordingStopFailureKind.UNKNOWN) {
                    // 살렸어도 이유를 모르는 플랫폼 실패다 — 그대로 이슈로 올린다(사용자는 들어 보고 정한다).
                    AlarmTalkLog.reportError(
                        "Voice recording stop failed but the file was readable elapsedMs=$elapsedMillis",
                        IllegalStateException("Recording stop failed.", error),
                    )
                } else {
                    AlarmTalkLog.breadcrumb(
                        category = "recording",
                        event = "Voice recording recovered after stop failure",
                        data = mapOf("elapsed_ms" to elapsedMillis, "kind" to kind.name.lowercase()),
                    )
                }
                return RecordingResult(audioStore.cachedRecording(file), endedBy, recoveredAfterStopFailure = true)
            }
            file.delete()
            val failure = when (kind) {
                RecordingStopFailureKind.PERMISSION_MISSING -> UserFacingException(
                    context.getString(R.string.recording_permission_missing),
                    RecordingPermissionMissingException(error),
                )
                RecordingStopFailureKind.INTERRUPTED -> UserFacingException(
                    context.getString(R.string.recording_interrupted_lost),
                    RecordingInterruptedException(requireNotNull(endedBy), error),
                )
                // 화면이 이유를 말하게 사용자 문구를 싣는다 — '녹음에 실패했어요' 로 뭉개면 다시 눌러 볼 이유를 모른다.
                RecordingStopFailureKind.STOPPED_TOO_SOON -> UserFacingException(
                    context.getString(R.string.recording_stopped_too_soon),
                    RecordingStoppedTooSoonException(elapsedMillis, error),
                )
                RecordingStopFailureKind.UNKNOWN -> IllegalStateException("Recording failed.", error)
            }
            AlarmTalkLog.reportError(
                "Voice recording failed elapsedMs=$elapsedMillis kind=${kind.name.lowercase()}",
                failure,
            )
            throw failure
        }

        Log.i(TAG, "Voice recording stopped path=${file.absolutePath} interruption=${endedBy?.diagnosticValue}")
        return RecordingResult(audioStore.cachedRecording(file), endedBy, recoveredAfterStopFailure = false)
    }

    fun cancel() {
        val file = outputFile
        release()
        file?.delete()
        if (file != null) Log.i(TAG, "Voice recording cancelled path=${file.absolutePath}")
    }

    fun maxAmplitude(): Int = runCatching { recorder?.maxAmplitude ?: 0 }.getOrDefault(0)

    private fun release() {
        recorder?.release()
        recorder = null
        outputFile = null
        abandonAudioFocus()
    }

    private fun isReadable(file: File): Boolean =
        file.isFile && file.length() > 0 && (audioStore.readDurationMillis(file.toUri()) ?: 0L) > 0L

    private fun micPermissionGranted(): Boolean =
        context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

    /**
     * 녹음 동안 오디오 포커스를 쥔다 — 다른 앱의 음악이 마이크에 섞이지 않게 멈추고, 전화·다른 앱이 가져가면
     * [interruption] 으로 알린다. 알림음처럼 잠깐 줄이기만 하는 것(`CAN_DUCK`)은 끼어듦으로 보지 않는다.
     * 포커스를 못 받아도 녹음은 막지 않는다.
     */
    private fun requestAudioFocus() {
        val audioManager = context.getSystemService(AudioManager::class.java) ?: return
        val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE)
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build(),
            )
            .setOnAudioFocusChangeListener { change ->
                if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) {
                    interruption = interruption ?: RecordingInterruption.AUDIO_FOCUS_LOSS
                }
            }
            .build()
        runCatching { audioManager.requestAudioFocus(request) }
        focusRequest = request
    }

    private fun abandonAudioFocus() {
        val request = focusRequest ?: return
        focusRequest = null
        runCatching { context.getSystemService(AudioManager::class.java)?.abandonAudioFocusRequest(request) }
    }

    private fun newRecorder(): MediaRecorder =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            MediaRecorder(context)
        } else {
            @Suppress("DEPRECATION")
            MediaRecorder()
        }
}
