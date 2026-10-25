package com.alarmtalk.app.data

import android.content.Context
import android.media.MediaRecorder
import android.os.Build
import android.os.SystemClock
import android.util.Log
import com.alarmtalk.app.R
import com.alarmtalk.app.core.AlarmTalkLog
import com.alarmtalk.app.core.AlarmTalkLog.TAG
import com.alarmtalk.app.UserFacingException
import java.io.File

/**
 * 녹음을 시작하자마자 멈춰 녹음기가 아무것도 쓰지 못했다는 표시(원인 사슬에 둔다). 사용자의 동작이지 결함이 아니라
 * [AlarmTalkLog] 가 이슈 대신 브레드크럼(`user`)으로 낮춘다 — Sentry ALARMTALK-ANDROID-1P.
 *
 * 기기에서 0.15초 만에 멈추면 `MediaRecorder.stop()` 이 `RuntimeException: stop failed.` 를 던진다(A32 계측 테스트
 * `AlarmVoiceRecorderInstrumentedTest`). 그 메시지는 플랫폼의 것이라 다른 실패와 구별되지 않으므로, 판정은 **시작에서
 * 멈춤까지의 시간**으로 한다.
 */
class RecordingStoppedTooSoonException(elapsedMillis: Long, cause: Throwable) :
    IllegalStateException("Recording stopped ${elapsedMillis}ms after start.", cause)

class AlarmVoiceRecorder(
    private val context: Context,
    private val audioStore: AlarmAudioStore,
) {
    private var recorder: MediaRecorder? = null
    private var outputFile: File? = null
    private var startedAtElapsedMillis = 0L

    val isRecording: Boolean
        get() = recorder != null

    fun start(maxDurationMillis: Long = AlarmAudioLimits.MAX_DURATION_MILLIS) {
        check(recorder == null) { "Recording is already in progress." }

        val file = audioStore.createRecordingFile()
        val mediaRecorder = newRecorder().apply {
            setAudioSource(MediaRecorder.AudioSource.MIC)
            setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            setAudioEncodingBitRate(128_000)
            setAudioSamplingRate(44_100)
            setMaxDuration(maxDurationMillis.toInt())
            setOutputFile(file.absolutePath)
            prepare()
            start()
        }

        outputFile = file
        recorder = mediaRecorder
        startedAtElapsedMillis = SystemClock.elapsedRealtime()
        Log.i(TAG, "Voice recording started path=${file.absolutePath}")
    }

    fun stop(): CachedAlarmAudio {
        val mediaRecorder = requireNotNull(recorder) { "Recording is not active." }
        val file = requireNotNull(outputFile) { "Recording output is missing." }

        val elapsedMillis = SystemClock.elapsedRealtime() - startedAtElapsedMillis
        val stopped = runCatching { mediaRecorder.stop() }
        release()
        stopped.exceptionOrNull()?.let { error ->
            file.delete()
            val failure = if (elapsedMillis < STOPPED_TOO_SOON_MILLIS) {
                // 화면이 이유를 말하게 사용자 문구를 싣는다 — '녹음에 실패했어요' 로 뭉개면 다시 눌러 볼 이유를 모른다.
                UserFacingException(
                    context.getString(R.string.recording_stopped_too_soon),
                    RecordingStoppedTooSoonException(elapsedMillis, error),
                )
            } else {
                IllegalStateException("Recording failed.", error)
            }
            AlarmTalkLog.reportError("Voice recording failed elapsedMs=$elapsedMillis path=${file.absolutePath}", failure)
            throw failure
        }

        Log.i(TAG, "Voice recording stopped path=${file.absolutePath}")
        return audioStore.cachedRecording(file)
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
    }

    private companion object {
        /** 이보다 빨리 멈춘 실패는 '시작하자마자 멈춤' 으로 읽는다. 녹음기가 첫 프레임을 쓰기 전 구간이다. */
        const val STOPPED_TOO_SOON_MILLIS = 1_000L
    }

    private fun newRecorder(): MediaRecorder =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            MediaRecorder(context)
        } else {
            @Suppress("DEPRECATION")
            MediaRecorder()
        }
}
