package com.alarmtalk.app

import android.content.Context
import androidx.annotation.StringRes
import com.alarmtalk.app.R
import com.alarmtalk.app.data.RecordingAdvisory
import com.alarmtalk.app.data.RecordingInterruption
import com.alarmtalk.app.data.RecordingQualityMetrics
import com.alarmtalk.app.data.RecordingQualityVerdict
import com.alarmtalk.app.data.RecordingRejection

/**
 * 녹음을 멈춘 뒤 등록 창이 할 일 — 품질 판정(`RecordingQualityAnalyzer`)과 멈춘 사정(끼어듦·멈춤 실패 뒤 복구)을 합친다.
 * 스펙 `docs/spec/voice-and-message.md` §4-1 「녹음 품질 판정」. iOS 짝은 `RecordingReview.decide`(`RecordingQuality.swift`).
 */
internal sealed interface RecordingReview {
    /** 그대로 쓴다 — 아무것도 묻지 않는다. */
    data object Accept : RecordingReview

    /** 버리고 다시 녹음하게 한다(확정 사유). 이유는 녹음 카드 아래 거절 줄에 쓴다. */
    data class Reject(val reason: RecordingRejection) : RecordingReview

    /** '그래도 쓰기' 와 '다시 녹음' 을 묻는다(권장 안내·끼어듦·복구한 녹음). */
    data class Ask(
        val advisories: List<RecordingAdvisory>,
        val recovered: Boolean,
        val interrupted: Boolean,
        val metrics: RecordingQualityMetrics,
    ) : RecordingReview
}

internal fun reviewRecording(
    verdict: RecordingQualityVerdict,
    recoveredAfterStopFailure: Boolean,
    interruption: RecordingInterruption?,
): RecordingReview = when (verdict) {
    is RecordingQualityVerdict.Rejected -> RecordingReview.Reject(verdict.reason)
    is RecordingQualityVerdict.Advisory -> RecordingReview.Ask(
        advisories = verdict.advisories,
        recovered = recoveredAfterStopFailure,
        interrupted = interruption != null,
        metrics = verdict.metrics,
    )
    // 품질은 괜찮아도 제대로 끝나지 않은 녹음은 들어 보고 정하게 한다 — 정상 완료본처럼 조용히 넘기지 않는다.
    is RecordingQualityVerdict.Passed -> if (recoveredAfterStopFailure || interruption != null) {
        RecordingReview.Ask(
            advisories = emptyList(),
            recovered = recoveredAfterStopFailure,
            interrupted = interruption != null,
            metrics = verdict.metrics,
        )
    } else {
        RecordingReview.Accept
    }
}

/** 판정용 디코딩 상한의 여유 — 녹음 상한(2분)을 조금 넘긴 측정값도 끝까지 읽는다. */
internal const val RECORDING_REVIEW_DECODE_SLACK_MILLIS = 5_000L

@StringRes
internal fun recordingRejectionMessageRes(reason: RecordingRejection): Int = when (reason) {
    RecordingRejection.TOO_SHORT -> R.string.voices_record_too_short
    RecordingRejection.UNREADABLE -> R.string.recording_rejected_unreadable
    RecordingRejection.NO_INPUT -> R.string.recording_rejected_no_input
}

@StringRes
internal fun recordingAdvisoryMessageRes(advisory: RecordingAdvisory): Int = when (advisory) {
    RecordingAdvisory.LITTLE_SPEECH -> R.string.recording_quality_little_speech
    RecordingAdvisory.MOSTLY_SILENT -> R.string.recording_quality_mostly_silent
    RecordingAdvisory.QUIET -> R.string.recording_quality_quiet
    RecordingAdvisory.CLIPPING -> R.string.recording_quality_clipping
}

/** 알럿 본문 — 멈춘 사정, 안내, 잰 수치(말소리로 들린 시간·전체 길이), 맺음말 순이다. 한 줄에 하나씩. */
internal fun recordingReviewMessage(context: Context, review: RecordingReview.Ask): String = buildList {
    when {
        review.recovered -> add(context.getString(R.string.recording_quality_recovered))
        review.interrupted -> add(context.getString(R.string.recording_interrupted_kept))
    }
    review.advisories.forEach { add(context.getString(recordingAdvisoryMessageRes(it))) }
    add(
        context.getString(
            R.string.recording_quality_summary,
            (review.metrics.speechMillis / 1000).toInt(),
            (review.metrics.durationMillis / 1000).toInt(),
        ),
    )
    if (review.advisories.isNotEmpty()) add(context.getString(R.string.recording_quality_footer))
}.joinToString("\n")
