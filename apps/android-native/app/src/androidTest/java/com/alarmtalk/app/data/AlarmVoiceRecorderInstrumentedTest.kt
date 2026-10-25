package com.alarmtalk.app.data

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.alarmtalk.app.core.AlarmTalkLog
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * 실제 [android.media.MediaRecorder] 로 **최대 길이까지 녹음한 뒤 멈추기**를 검증한다(Sentry ALARMTALK-ANDROID-1P).
 *
 * 녹음기는 `setMaxDuration` 에 닿으면 스스로 멈추고, 화면은 그보다 조금 늦게(시계를 늦게 켜고 0.25초마다 본다)
 * `stop()` 을 부른다. 그 `stop()` 은 기기에서 `RuntimeException: stop failed.` 를 던지는데, 예전 코드는 그것을
 * '너무 짧음' 으로 읽고 파일을 지워 **꽉 채운 녹음을 잃었다.** JVM 테스트에는 진짜 녹음기가 없어 기기에서만 볼 수 있다.
 *
 * 마이크 권한이 필요하다: `adb shell pm grant com.alarmtalk.app.dev android.permission.RECORD_AUDIO`.
 */
@RunWith(AndroidJUnit4::class)
class AlarmVoiceRecorderInstrumentedTest {

    private val context = InstrumentationRegistry.getInstrumentation().targetContext

    @Before
    fun grantMicrophone() {
        InstrumentationRegistry.getInstrumentation().uiAutomation
            .grantRuntimePermission(context.packageName, android.Manifest.permission.RECORD_AUDIO)
    }

    @Test
    fun stoppingAfterTheRecorderReachedMaxDurationKeepsTheRecording() {
        val recorder = AlarmVoiceRecorder(context, AlarmAudioStore(context))
        recorder.start(maxDurationMillis = 2_000)
        Thread.sleep(3_500)
        val audio = recorder.stop()
        val duration = audio.durationMillis
        assertNotNull(duration)
        assertTrue("duration=$duration", duration!! in 1_500..2_600)
    }

    @Test
    fun stoppingBeforeTheLimitStillWorks() {
        val recorder = AlarmVoiceRecorder(context, AlarmAudioStore(context))
        recorder.start(maxDurationMillis = 10_000)
        Thread.sleep(2_000)
        val audio = recorder.stop()
        assertTrue("duration=${audio.durationMillis}", (audio.durationMillis ?: 0) >= 1_500)
    }

    @Test
    fun stoppingRightAfterStartIsReportedAsTooShort() {
        // 기기에서 이 경우 MediaRecorder.stop() 이 Sentry 1P 와 같은 "stop failed." 를 던진다(A32 로 확인).
        val recorder = AlarmVoiceRecorder(context, AlarmAudioStore(context))
        recorder.start(maxDurationMillis = 10_000)
        Thread.sleep(150)
        val error = runCatching { recorder.stop() }.exceptionOrNull()
        assertNotNull(error)
        assertTrue("$error", AlarmTalkLog.isRecordingStoppedTooSoon(error!!))
        assertTrue(error.message.orEmpty().isNotBlank())
        assertTrue(!recorder.isRecording)
    }
}
