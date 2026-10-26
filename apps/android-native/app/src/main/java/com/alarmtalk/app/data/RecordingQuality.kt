package com.alarmtalk.app.data

import kotlin.math.abs
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * 녹음 품질 판정의 임계값 — **유일 출처**다. 스펙 `docs/spec/voice-and-message.md` §4-1 「녹음 품질 판정」 표와
 * iOS `RecordingQualityThresholds`(`RecordingQuality.swift`)가 같은 숫자를 쓴다. 한쪽만 고치지 말 것.
 *
 * ⚠ **작은 목소리를 거절하지 않는다.** 확정 거절은 '너무 짧음·읽을 수 없음·입력 없음(디지털 무음)' 셋뿐이고, 크기·
 * 무음·클리핑은 전부 권장 안내다(그래도 쓰기 / 다시 녹음). 이 수치는 기본 신호 검사이지 화자 확인·본인 확인·음성 복제
 * 적합성의 증명이 아니다.
 */
object RecordingQualityThresholds {
    /** 판정은 이 샘플레이트의 모노로 한다 — 정규화는 [MonoPcmNormalizer] 한 곳이다. */
    const val ANALYSIS_SAMPLE_RATE = 16_000

    /** 에너지를 재는 프레임 길이. */
    const val FRAME_MILLIS = 20

    /** 디코딩한 길이가 기준보다 이만큼 짧아도 '너무 짧음' 으로 읽지 않는다(AAC 앞뒤 여백·메타데이터 반올림). */
    const val DECODED_DURATION_TOLERANCE_MILLIS = 500L

    /** 피크가 이보다 작으면 마이크에서 아무것도 들어오지 않은 것이다(확정 거절 — 조용한 방의 잡음도 이보다 크다). */
    const val NO_INPUT_PEAK_DBFS = -80.0

    /** 말소리 프레임의 절대 하한. 아무리 조용한 방이어도 이보다 작은 프레임은 말소리로 세지 않는다. */
    const val ACTIVE_FRAME_FLOOR_DBFS = -60.0

    /** 잡음 바닥(프레임 에너지의 하위 [NOISE_FLOOR_PERCENTILE])보다 이만큼 크면 말소리 프레임이다. */
    const val ACTIVE_FRAME_MARGIN_DB = 10.0
    const val NOISE_FLOOR_PERCENTILE = 0.10

    /** 말한 시간이 이보다 짧으면 '말소리가 거의 없어요' 안내. */
    const val LITTLE_SPEECH_MILLIS = 3_000L

    /** 말하지 않은 구간이 이 비율 이상이면 '말하지 않은 시간이 길어요' 안내. */
    const val MOSTLY_SILENT_RATIO = 0.60

    /** 말소리 구간의 평균 크기(RMS)가 이보다 작으면 '목소리가 작게 녹음됐어요' 안내 — 거절하지 않는다. */
    const val QUIET_SPEECH_RMS_DBFS = -40.0

    /** 이 크기(절댓값, 최대 1) 이상인 샘플을 잘린(클리핑) 샘플로 센다. */
    const val CLIPPED_SAMPLE_LEVEL = 0.98f

    /** 잘린 샘플이 전체의 이 비율 이상이면 '소리가 너무 커서 일부가 찌그러졌어요' 안내. */
    const val CLIPPING_RATIO = 0.002
}

/** 확정 거절 — 다시 녹음하는 길만 준다. */
enum class RecordingRejection(val diagnosticValue: String) {
    TOO_SHORT("too_short"),
    UNREADABLE("unreadable"),
    NO_INPUT("no_input"),
}

/** 권장 안내 — '그래도 쓰기' 와 '다시 녹음' 을 둘 다 준다. 화면에 그리는 순서다. */
enum class RecordingAdvisory(val diagnosticValue: String) {
    LITTLE_SPEECH("little_speech"),
    MOSTLY_SILENT("mostly_silent"),
    QUIET("quiet"),
    CLIPPING("clipping"),
}

/**
 * 말한 시간을 무엇으로 셌는가. ⚠ VAD 가 꽂히지 않은 환경은 언제나 [BASIC_SIGNAL] 이다 — 화면·진단 어디에도
 * 'VAD 통과' 라고 말하지 않는다.
 */
enum class SpeechDetectionMethod(val diagnosticValue: String) {
    BASIC_SIGNAL("basic_signal"),
    VAD("vad"),
}

/**
 * 말소리 구간 검출기(Silero VAD 등)를 꽂는 자리. 지금은 번들한 구현이 **없다**(스펙 「녹음 품질 판정」 — 출처·
 * 라이선스 기록). 돌지 못하면 null 을 돌려주고, 그러면 판정은 기본 신호 검사로 센다.
 */
fun interface VoiceActivityDetector {
    /** [samples] 는 [RecordingQualityThresholds.ANALYSIS_SAMPLE_RATE] 의 모노(-1..1)다. 말한 시간(ms) 또는 null. */
    fun speechMillis(samples: FloatArray, sampleRate: Int): Long?
}

/** 판단에 필요한 수치만 — 오디오·받아쓰기 원문은 싣지 않는다. */
data class RecordingQualityMetrics(
    val durationMillis: Long,
    val speechMillis: Long,
    val silenceRatio: Double,
    val peakDbfs: Double,
    /** 말소리 프레임의 평균 크기. 말소리 프레임이 없으면 null. */
    val speechRmsDbfs: Double?,
    val clippingRatio: Double,
    val method: SpeechDetectionMethod,
)

sealed interface RecordingQualityVerdict {
    val metrics: RecordingQualityMetrics?

    data class Rejected(
        val reason: RecordingRejection,
        override val metrics: RecordingQualityMetrics?,
    ) : RecordingQualityVerdict

    data class Advisory(
        val advisories: List<RecordingAdvisory>,
        override val metrics: RecordingQualityMetrics,
    ) : RecordingQualityVerdict

    data class Passed(override val metrics: RecordingQualityMetrics) : RecordingQualityVerdict
}

/** 진단(브레드크럼)에 싣는 값 — 숫자와 판정 코드뿐이다. iOS `RecordingQualityVerdict.diagnostics` 와 같은 키. */
fun RecordingQualityVerdict.diagnostics(): Map<String, Any> = buildMap {
    put(
        "verdict",
        when (this@diagnostics) {
            is RecordingQualityVerdict.Rejected -> "rejected"
            is RecordingQualityVerdict.Advisory -> "advisory"
            is RecordingQualityVerdict.Passed -> "passed"
        },
    )
    when (val verdict = this@diagnostics) {
        is RecordingQualityVerdict.Rejected -> put("reason", verdict.reason.diagnosticValue)
        is RecordingQualityVerdict.Advisory -> put("advisories", verdict.advisories.joinToString(",") { it.diagnosticValue })
        is RecordingQualityVerdict.Passed -> Unit
    }
    metrics?.let { m ->
        put("method", m.method.diagnosticValue)
        put("duration_ms", m.durationMillis)
        put("speech_ms", m.speechMillis)
        put("silence_pct", (m.silenceRatio * 100).roundToInt())
        put("peak_dbfs", m.peakDbfs.roundToInt())
        m.speechRmsDbfs?.let { put("speech_rms_dbfs", it.roundToInt()) }
        put("clipping_permille", (m.clippingRatio * 1000).roundToInt())
    }
}

/**
 * 판정 입력의 샘플레이트 정규화 — **한 곳**이다. 채널은 디코더([VoiceAudioDecoder] — 앱의 유일한 디코더)가 이미 평균으로
 * 섞어 모노로 준다. 여기서는 그 모노를 [RecordingQualityThresholds.ANALYSIS_SAMPLE_RATE] 로 선형 보간한다 — 판정 수치가
 * 기기의 녹음 샘플레이트(44.1·48 kHz …)에 따라 달라지지 않게. iOS 짝은 `MonoPcmNormalizer`(`RecordingQuality.swift`)이고,
 * 그쪽도 채널은 디코더(`VoiceTuningAnalyzer.decodeMono`)가 섞는다.
 */
object MonoPcmNormalizer {
    fun toAnalysisRate(
        samples: FloatArray,
        sourceSampleRate: Int,
        targetSampleRate: Int = RecordingQualityThresholds.ANALYSIS_SAMPLE_RATE,
    ): FloatArray {
        if (samples.isEmpty() || sourceSampleRate <= 0 || targetSampleRate <= 0) return FloatArray(0)
        if (sourceSampleRate == targetSampleRate) return samples.copyOf()
        val step = sourceSampleRate.toDouble() / targetSampleRate
        val outputSize = ((samples.size - 1) / step).toInt() + 1
        return FloatArray(outputSize) { i ->
            val position = i * step
            val left = position.toInt().coerceAtMost(samples.size - 1)
            val right = (left + 1).coerceAtMost(samples.size - 1)
            val t = (position - left).toFloat()
            samples[left] + (samples[right] - samples[left]) * t
        }
    }
}

/**
 * 기본 신호 검사 — 순수 함수다. 정규화한 모노 PCM(-1..1)에서 길이·말한 시간·무음 비율·피크·말소리 크기·클리핑을 재고
 * 판정 셋(확정 거절 / 권장 안내 / 통과) 중 하나로 답한다. iOS `RecordingQualityAnalyzer.analyze` 와 같은 규칙이다.
 */
object RecordingQualityAnalyzer {

    fun analyze(
        samples: FloatArray?,
        minDurationMillis: Long,
        sampleRate: Int = RecordingQualityThresholds.ANALYSIS_SAMPLE_RATE,
        voiceActivityDetector: VoiceActivityDetector? = null,
    ): RecordingQualityVerdict {
        if (samples == null || samples.isEmpty() || sampleRate <= 0) {
            return RecordingQualityVerdict.Rejected(RecordingRejection.UNREADABLE, null)
        }
        val durationMillis = samples.size * 1000L / sampleRate

        var peak = 0f
        var clipped = 0L
        for (sample in samples) {
            val level = abs(sample)
            if (level > peak) peak = level
            if (level >= RecordingQualityThresholds.CLIPPED_SAMPLE_LEVEL) clipped += 1
        }
        val peakDbfs = toDb(peak.toDouble() * peak)
        val clippingRatio = clipped.toDouble() / samples.size

        val frameLength = max(1, sampleRate * RecordingQualityThresholds.FRAME_MILLIS / 1000)
        val frameCount = samples.size / frameLength
        val frameEnergy = DoubleArray(frameCount) { frame ->
            var sum = 0.0
            val start = frame * frameLength
            for (i in start until start + frameLength) sum += samples[i].toDouble() * samples[i]
            sum / frameLength
        }
        val frameDb = DoubleArray(frameCount) { toDb(frameEnergy[it]) }
        val noiseFloorDb = if (frameCount == 0) {
            peakDbfs
        } else {
            val sorted = frameDb.sortedArray()
            sorted[((frameCount - 1) * RecordingQualityThresholds.NOISE_FLOOR_PERCENTILE).toInt()]
        }
        val activeThresholdDb = max(
            noiseFloorDb + RecordingQualityThresholds.ACTIVE_FRAME_MARGIN_DB,
            RecordingQualityThresholds.ACTIVE_FRAME_FLOOR_DBFS,
        )
        var activeFrames = 0
        var activeEnergy = 0.0
        for (frame in 0 until frameCount) {
            if (frameDb[frame] >= activeThresholdDb) {
                activeFrames += 1
                activeEnergy += frameEnergy[frame]
            }
        }
        val basicSpeechMillis = activeFrames.toLong() * RecordingQualityThresholds.FRAME_MILLIS
        val vadSpeechMillis = voiceActivityDetector?.speechMillis(samples, sampleRate)
        val method = if (vadSpeechMillis != null) SpeechDetectionMethod.VAD else SpeechDetectionMethod.BASIC_SIGNAL
        val speechMillis = (vadSpeechMillis ?: basicSpeechMillis).coerceIn(0L, durationMillis)
        val silenceRatio = if (durationMillis == 0L) 1.0 else 1.0 - speechMillis.toDouble() / durationMillis
        val speechRmsDbfs = if (activeFrames > 0) toDb(activeEnergy / activeFrames) else null

        val metrics = RecordingQualityMetrics(
            durationMillis = durationMillis,
            speechMillis = speechMillis,
            silenceRatio = silenceRatio.coerceIn(0.0, 1.0),
            peakDbfs = peakDbfs,
            speechRmsDbfs = speechRmsDbfs,
            clippingRatio = clippingRatio,
            method = method,
        )

        if (durationMillis + RecordingQualityThresholds.DECODED_DURATION_TOLERANCE_MILLIS < minDurationMillis) {
            return RecordingQualityVerdict.Rejected(RecordingRejection.TOO_SHORT, metrics)
        }
        if (peakDbfs < RecordingQualityThresholds.NO_INPUT_PEAK_DBFS) {
            return RecordingQualityVerdict.Rejected(RecordingRejection.NO_INPUT, metrics)
        }

        val advisories = buildList {
            val littleSpeech = speechMillis < RecordingQualityThresholds.LITTLE_SPEECH_MILLIS
            if (littleSpeech) {
                add(RecordingAdvisory.LITTLE_SPEECH)
            } else if (metrics.silenceRatio >= RecordingQualityThresholds.MOSTLY_SILENT_RATIO) {
                add(RecordingAdvisory.MOSTLY_SILENT)
            }
            if (!littleSpeech && speechRmsDbfs != null && speechRmsDbfs < RecordingQualityThresholds.QUIET_SPEECH_RMS_DBFS) {
                add(RecordingAdvisory.QUIET)
            }
            if (clippingRatio >= RecordingQualityThresholds.CLIPPING_RATIO) add(RecordingAdvisory.CLIPPING)
        }
        return if (advisories.isEmpty()) {
            RecordingQualityVerdict.Passed(metrics)
        } else {
            RecordingQualityVerdict.Advisory(advisories, metrics)
        }
    }

    /** 평균 제곱(에너지)을 dBFS 로. 0 은 아주 작은 값으로 막는다. */
    private fun toDb(meanSquare: Double): Double = 10.0 * log10(meanSquare.coerceAtLeast(1e-12))
}
