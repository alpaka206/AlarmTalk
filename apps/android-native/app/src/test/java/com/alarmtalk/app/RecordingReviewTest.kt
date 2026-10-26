package com.alarmtalk.app

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.alarmtalk.app.core.AlarmTalkLog
import com.alarmtalk.app.data.RecordingAdvisory
import com.alarmtalk.app.data.RecordingInterruption
import com.alarmtalk.app.data.RecordingInterruptedException
import com.alarmtalk.app.data.RecordingPermissionMissingException
import com.alarmtalk.app.data.RecordingQualityMetrics
import com.alarmtalk.app.data.RecordingQualityVerdict
import com.alarmtalk.app.data.RecordingRejection
import com.alarmtalk.app.data.RecordingStopFailureKind
import com.alarmtalk.app.data.SpeechDetectionMethod
import com.alarmtalk.app.data.classifyRecordingStopFailure
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * 녹음을 멈춘 뒤의 갈래 — 멈춤 실패 분류, 판정과 멈춘 사정을 합친 결과, 알럿 본문(스펙 voice-and-message §4-1
 * 「녹음 품질 판정」).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class RecordingReviewTest {
    private val context: Context get() = ApplicationProvider.getApplicationContext()

    private val metrics = RecordingQualityMetrics(
        durationMillis = 20_400,
        speechMillis = 8_900,
        silenceRatio = 0.56,
        peakDbfs = -9.0,
        speechRmsDbfs = -44.0,
        clippingRatio = 0.0,
        method = SpeechDetectionMethod.BASIC_SIGNAL,
    )

    @Test
    fun stopFailuresSplitByPermissionInterruptionAndTime() {
        assertEquals(
            RecordingStopFailureKind.PERMISSION_MISSING,
            classifyRecordingStopFailure(30_000, micPermissionGranted = false, interruption = RecordingInterruption.AUDIO_FOCUS_LOSS),
        )
        assertEquals(
            RecordingStopFailureKind.INTERRUPTED,
            classifyRecordingStopFailure(200, micPermissionGranted = true, interruption = RecordingInterruption.AUDIO_FOCUS_LOSS),
        )
        assertEquals(
            RecordingStopFailureKind.STOPPED_TOO_SOON,
            classifyRecordingStopFailure(150, micPermissionGranted = true, interruption = null),
        )
        assertEquals(
            RecordingStopFailureKind.UNKNOWN,
            classifyRecordingStopFailure(30_000, micPermissionGranted = true, interruption = null),
        )
    }

    @Test
    fun permissionAndInterruptionAreUserBreadcrumbsNotIssues() {
        val platform = RuntimeException("stop failed.")
        assertEquals(
            "user",
            AlarmTalkLog.breadcrumbCategoryFor(UserFacingException("x", RecordingPermissionMissingException(platform))),
        )
        assertEquals(
            "user",
            AlarmTalkLog.breadcrumbCategoryFor(
                UserFacingException("x", RecordingInterruptedException(RecordingInterruption.AUDIO_FOCUS_LOSS, platform)),
            ),
        )
        // 이유를 모르는 멈춤 실패는 그대로 이슈다.
        assertNull(AlarmTalkLog.breadcrumbCategoryFor(IllegalStateException("Recording failed.", platform)))
    }

    @Test
    fun verdictAndStopCircumstancesCombine() {
        assertEquals(RecordingReview.Accept, reviewRecording(RecordingQualityVerdict.Passed(metrics), false, null))
        assertEquals(
            RecordingReview.Reject(RecordingRejection.NO_INPUT),
            reviewRecording(RecordingQualityVerdict.Rejected(RecordingRejection.NO_INPUT, metrics), true, null),
        )
        val advisory = reviewRecording(
            RecordingQualityVerdict.Advisory(listOf(RecordingAdvisory.QUIET), metrics),
            false,
            null,
        ) as RecordingReview.Ask
        assertEquals(listOf(RecordingAdvisory.QUIET), advisory.advisories)
        assertFalse(advisory.recovered)
        // 품질이 괜찮아도 제대로 끝나지 않은 녹음은 묻는다 — 정상 완료본처럼 넘기지 않는다.
        val recovered = reviewRecording(RecordingQualityVerdict.Passed(metrics), true, null) as RecordingReview.Ask
        assertTrue(recovered.recovered)
        assertTrue(recovered.advisories.isEmpty())
        val interrupted = reviewRecording(
            RecordingQualityVerdict.Passed(metrics),
            false,
            RecordingInterruption.AUDIO_FOCUS_LOSS,
        ) as RecordingReview.Ask
        assertTrue(interrupted.interrupted)
    }

    @Test
    @Config(qualifiers = "ko")
    fun alertMessageSaysWhatWasMeasured() {
        val message = recordingReviewMessage(
            context,
            RecordingReview.Ask(listOf(RecordingAdvisory.QUIET), recovered = false, interrupted = true, metrics = metrics),
        )
        assertEquals(
            listOf(
                context.getString(R.string.recording_interrupted_kept),
                context.getString(R.string.recording_quality_quiet),
                "말소리로 들린 시간 약 8초 · 전체 20초",
                context.getString(R.string.recording_quality_footer),
            ),
            message.lines(),
        )
        // 'VAD' 라는 말은 화면에 나가지 않는다.
        assertFalse(message.contains("VAD"))
    }

    @Test
    @Config(qualifiers = "en")
    fun alertMessageWithoutAdvisoriesHasNoFooter() {
        val message = recordingReviewMessage(
            context,
            RecordingReview.Ask(emptyList(), recovered = true, interrupted = false, metrics = metrics),
        )
        assertEquals(
            listOf(
                context.getString(R.string.recording_quality_recovered),
                "Speech heard: about 8 s · Total: 20 s",
            ),
            message.lines(),
        )
    }

    @Test
    @Config(qualifiers = "en")
    fun cloningFailureDoesNotBlameTheRecording() {
        // 제공자 장애·서버 오류(500 VOICE_CLONING_FAILED)를 '나쁜 녹음' 으로 안내하지 않는다.
        val message = context.getString(R.string.api_error_voice_cloning_failed)
        assertFalse(message, message.contains("record", ignoreCase = true))
    }
}
