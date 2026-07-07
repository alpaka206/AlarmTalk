package com.alarmtalk.app.data

import android.content.Context
import android.media.MediaRecorder
import android.os.Build
import android.util.Log
import com.alarmtalk.app.core.AlarmTalkLog
import com.alarmtalk.app.core.AlarmTalkLog.TAG
import java.io.File

class AlarmVoiceRecorder(
    private val context: Context,
    private val audioStore: AlarmAudioStore,
) {
    private var recorder: MediaRecorder? = null
    private var outputFile: File? = null

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
        Log.i(TAG, "Voice recording started path=${file.absolutePath}")
    }

    fun stop(): CachedAlarmAudio {
        val mediaRecorder = requireNotNull(recorder) { "Recording is not active." }
        val file = requireNotNull(outputFile) { "Recording output is missing." }

        val stopped = runCatching {
            mediaRecorder.stop()
        }.onFailure { error ->
            file.delete()
            AlarmTalkLog.reportError("Voice recording failed path=${file.absolutePath}", error)
        }
        release()
        stopped.getOrElse { error ->
            throw IllegalStateException("Recording was too short or failed.", error)
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

    private fun newRecorder(): MediaRecorder =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            MediaRecorder(context)
        } else {
            @Suppress("DEPRECATION")
            MediaRecorder()
        }
}
